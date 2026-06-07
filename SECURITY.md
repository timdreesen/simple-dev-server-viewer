# Security Policy

## Reporting a Vulnerability

Do not open a public issue for vulnerabilities involving arbitrary command execution, unsafe process termination, path disclosure, or privilege escalation. Report them privately through GitHub Security Advisories.

Include affected versions, reproduction steps, impact, and any suggested mitigation. Maintainers will acknowledge reports as quickly as practical.

## Scope

Simple Dev Server Viewer reads local process metadata and can terminate processes selected by the user. It does not require elevated privileges, send telemetry, or accept remote connections. Treat builds from untrusted sources as untrusted executables.
