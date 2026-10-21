//! Reads a local page's title and favicon so a service can be recognized at a
//! glance. Only `localhost` and loopback or private IP addresses are fetched,
//! so a page can never make the app reach out to the internet (redirects are
//! checked the same way).

use serde::Serialize;
use std::time::Duration;
use url::{Host, Url};

const MAX_REDIRECTS: usize = 3;
const MAX_BODY_BYTES: u64 = 512 * 1024;
const MAX_TITLE_CHARS: usize = 120;

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct PageInfo {
    pub title: Option<String>,
    pub favicon: Option<String>,
}

/// Hosts the app is allowed to fetch: `localhost` and the loopback or private
/// addresses the port scanner reports (e.g. WSL), never domain names.
pub fn is_local_url(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    match url.host() {
        Some(Host::Domain(domain)) => domain == "localhost",
        Some(Host::Ipv4(ip)) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        // fc00::/7 is the IPv6 equivalent of a private network.
        Some(Host::Ipv6(ip)) => ip.is_loopback() || (ip.segments()[0] & 0xfe00) == 0xfc00,
        None => false,
    }
}

pub fn fetch(url: &str) -> Result<PageInfo, String> {
    let mut url = Url::parse(url).map_err(|error| error.to_string())?;
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(2)))
        .max_redirects(0)
        .http_status_as_error(false)
        .build()
        .into();

    for _ in 0..=MAX_REDIRECTS {
        if !is_local_url(&url) {
            return Err("Only local pages can be previewed".into());
        }
        let mut response = agent
            .get(url.as_str())
            .header("Accept", "text/html")
            .call()
            .map_err(|error| error.to_string())?;

        if response.status().is_redirection() {
            let location = response
                .headers()
                .get("location")
                .and_then(|value| value.to_str().ok())
                .ok_or("Redirect without a location")?;
            url = url.join(location).map_err(|error| error.to_string())?;
            continue;
        }

        let is_html = response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.contains("html"));
        if !is_html {
            return Ok(PageInfo::default());
        }
        let body = response
            .body_mut()
            .with_config()
            .limit(MAX_BODY_BYTES)
            .read_to_vec()
            .map_err(|error| error.to_string())?;
        return Ok(parse(&String::from_utf8_lossy(&body), &url));
    }
    Err("Too many redirects".into())
}

pub fn parse(html: &str, base: &Url) -> PageInfo {
    PageInfo {
        title: title(html),
        favicon: favicon_href(html)
            .and_then(|href| base.join(&href).ok())
            .or_else(|| base.join("/favicon.ico").ok())
            .filter(|icon| matches!(icon.scheme(), "http" | "https" | "data"))
            .map(String::from),
    }
}

fn title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let open = lower.find("<title")?;
    let start = open + lower[open..].find('>')? + 1;
    let end = start + lower[start..].find("</title")?;
    let text = decode_entities(&html[start..end])
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    (!text.is_empty()).then(|| text.chars().take(MAX_TITLE_CHARS).collect())
}

/// The `href` of the first `<link rel="icon">`, falling back to an Apple touch icon.
fn favicon_href(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let mut touch_icon = None;
    let mut from = 0;
    while let Some(offset) = lower[from..].find("<link") {
        let start = from + offset;
        let end = start + lower[start..].find('>').unwrap_or(lower.len() - start);
        from = end;
        let tag = &html[start..end];
        let (Some(rel), Some(href)) = (attribute(tag, "rel"), attribute(tag, "href")) else {
            continue;
        };
        let rel = rel.to_ascii_lowercase();
        if rel.split_whitespace().any(|token| token == "icon") {
            return Some(decode_entities(&href));
        }
        if touch_icon.is_none() && rel.contains("apple-touch-icon") {
            touch_icon = Some(decode_entities(&href));
        }
    }
    touch_icon
}

fn attribute(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut from = 0;
    while let Some(offset) = lower[from..].find(name) {
        let start = from + offset;
        from = start + name.len();
        let preceded_by_space = lower[..start]
            .chars()
            .last()
            .is_some_and(char::is_whitespace);
        let rest = lower[from..].trim_start();
        if !preceded_by_space || !rest.starts_with('=') {
            continue;
        }
        let value_start = tag.len() - rest.len() + 1;
        let value = tag[value_start..].trim_start();
        return Some(match value.chars().next()? {
            quote @ ('"' | '\'') => value[1..].split(quote).next()?.to_string(),
            _ => value
                .split(|c: char| c.is_whitespace() || c == '>' || c == '/')
                .next()?
                .to_string(),
        });
    }
    None
}

fn decode_entities(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Url {
        Url::parse("http://localhost:3000/app/").unwrap()
    }

    #[test]
    fn reads_title_and_icon() {
        let html = r#"<html><head>
            <TITLE>
              Admin &amp; Reports
            </TITLE>
            <link rel="stylesheet" href="/app.css">
            <link href='/static/logo.svg' rel='icon' type='image/svg+xml'>
        </head></html>"#;
        assert_eq!(
            parse(html, &base()),
            PageInfo {
                title: Some("Admin & Reports".into()),
                favicon: Some("http://localhost:3000/static/logo.svg".into()),
            }
        );
    }

    #[test]
    fn falls_back_to_touch_icon_then_favicon_ico() {
        let touch = r#"<link rel="apple-touch-icon" href="touch.png"><title></title>"#;
        let info = parse(touch, &base());
        assert_eq!(info.title, None);
        assert_eq!(
            info.favicon.as_deref(),
            Some("http://localhost:3000/app/touch.png")
        );

        let bare = parse("<p>hello</p>", &base());
        assert_eq!(
            bare.favicon.as_deref(),
            Some("http://localhost:3000/favicon.ico")
        );
    }

    #[test]
    fn prefers_icon_over_earlier_touch_icon() {
        let html = r#"<link rel="apple-touch-icon" href="/t.png"><link rel="shortcut icon" href="/f.ico">"#;
        assert_eq!(
            parse(html, &base()).favicon.as_deref(),
            Some("http://localhost:3000/f.ico")
        );
    }

    #[test]
    fn ignores_unsafe_icon_schemes() {
        let html = r#"<link rel="icon" href="javascript:alert(1)">"#;
        assert_eq!(parse(html, &base()).favicon, None);
    }

    #[test]
    fn only_local_hosts_are_allowed() {
        for url in [
            "http://localhost:5173",
            "http://127.0.0.1:8000/x",
            "http://[::1]:3000",
            "https://192.168.1.20:8443",
            "http://172.20.0.5:3000",
        ] {
            assert!(is_local_url(&Url::parse(url).unwrap()), "{url}");
        }
        for url in [
            "https://example.com",
            "http://localhost.evil.com",
            "http://8.8.8.8",
            "http://[2001:db8::1]",
            "file:///etc/passwd",
        ] {
            assert!(!is_local_url(&Url::parse(url).unwrap()), "{url}");
        }
    }
}
