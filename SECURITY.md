# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in the GNDK Token smart contracts, please report it responsibly.

**DO NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

Email: **kyss.corp@gmail.com**

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 1 week
- **Fix & Disclosure**: Coordinated with reporter

### Scope

| In Scope | Out of Scope |
|----------|-------------|
| Smart contract logic bugs | Frontend/website issues |
| Token transfer vulnerabilities | Social engineering |
| Access control bypasses | Third-party dependencies |
| Arithmetic overflow/underflow | Already known issues |
| PDA seed collisions | Localnet/devnet only issues |

### Audit Status

These contracts have **not yet been formally audited**. A third-party audit is planned before mainnet deployment.

## Supported Versions

| Version | Supported |
|---------|-----------|
| main branch | Yes |
| Other branches | No |
