# Security policy

## Supported versions

Only the latest release, the one deployed at <https://tilepier.win>, receives
security fixes. TilePier is a single deployment rather than a library, so there
is no older line to patch.

## Reporting a vulnerability

Please report privately through GitHub's
[private vulnerability reporting](https://github.com/poli0981/tilepier/security/advisories/new),
not in a public issue, discussion or pull request.

Include what you can of the affected URL or file, the steps to reproduce, the
impact you see, and whether it is already public. English or Vietnamese.

- You get a first response within **72 hours**.
- You hear how it is going while the report is confirmed and fixed, and the
  disclosure date is agreed with you. The advisory credits you unless you ask it
  not to.
- There is no bug bounty.

## Scope

In scope: the app at <https://tilepier.win>, its `/api/*` Worker, and this
repository's code and workflows.

Out of scope, with thanks for reporting them where they belong: the services
TilePier relies on (Cloudflare, Open-Meteo, Finnhub, Twelve Data, Binance.US,
OpenFreeMap, Photon, Nominatim) and the feeds readers add themselves; attacks
that need a compromised device or browser; denial of service by volume; and
scanner output with no demonstrated impact.

The machine-readable contact is
[`/.well-known/security.txt`](https://tilepier.win/.well-known/security.txt)
(RFC 9116).
