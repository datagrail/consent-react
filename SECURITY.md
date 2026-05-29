# Security Policy

## Supported Versions

| Version         | Supported          |
| --------------- | ------------------ |
| 0.1.x (latest)  | :white_check_mark: |

## Reporting a Vulnerability

**Please do NOT file public GitHub issues for security vulnerabilities.**

If you discover a security vulnerability in `@datagrail/react-native-consent`, please report it responsibly by emailing:

**security@datagrail.com**

### What to include

- A description of the vulnerability
- Steps to reproduce or a proof-of-concept
- The potential impact
- Any suggested fixes (optional)

### Response timeline

- **Acknowledgment**: Within 2 business days of receipt
- **Initial assessment**: Within 5 business days
- **Resolution target**: Within 30 days for critical issues, 90 days for non-critical

### What to expect

1. We will acknowledge your report and provide a tracking identifier.
2. We will investigate and validate the vulnerability.
3. We will work on a fix and coordinate disclosure timing with you.
4. We will credit you in the release notes (unless you prefer to remain anonymous).

### Scope

This policy applies to the `@datagrail/react-native-consent` npm package and its bundled dependencies. For vulnerabilities in the DataGrail platform or APIs, please contact security@datagrail.com directly.

## Security Best Practices

When using this SDK:

- Always use HTTPS config URLs (the SDK enforces this)
- Keep the SDK updated to the latest version
- Do not log or expose consent payloads in production builds
- Use the Expo config plugin or manual Info.plist configuration for ATT — never hardcode tracking descriptions at runtime
