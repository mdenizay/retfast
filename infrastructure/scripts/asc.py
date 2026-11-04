#!/usr/bin/env python3
"""Minimal App Store Connect API client (no third-party deps; ES256 via openssl).

Env: ASC_KEY_ID, ASC_ISSUER_ID; key file ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8
Usage:
  asc.py GET  /v1/apps?filter[bundleId]=com.mizibu.retfast
  asc.py POST /v1/... '{"data": ...}'
  asc.py PATCH /v1/... '{"data": ...}'
Prints the JSON response. Never prints the key or the token.
"""
import base64, json, os, subprocess, sys, time, urllib.error, urllib.request

KEY_ID = os.environ.get("ASC_KEY_ID", "8X22AD2UA9")
ISSUER = os.environ.get("ASC_ISSUER_ID", "801e6636-e2fc-461d-a9c2-0d87a7ed71b3")
KEY = os.path.expanduser(f"~/.appstoreconnect/private_keys/AuthKey_{KEY_ID}.p8")


def b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def der_to_raw(der: bytes) -> bytes:
    # ECDSA DER: 30 len 02 lr r 02 ls s  ->  r||s (32 bytes each)
    i = 2
    assert der[i] == 2
    lr = der[i + 1]; r = der[i + 2:i + 2 + lr]; i += 2 + lr
    assert der[i] == 2
    ls = der[i + 1]; s = der[i + 2:i + 2 + ls]
    return r.lstrip(b"\0").rjust(32, b"\0") + s.lstrip(b"\0").rjust(32, b"\0")


def token() -> str:
    now = int(time.time())
    head = b64(json.dumps({"alg": "ES256", "kid": KEY_ID, "typ": "JWT"}).encode())
    body = b64(json.dumps({"iss": ISSUER, "iat": now, "exp": now + 900, "aud": "appstoreconnect-v1"}).encode())
    msg = f"{head}.{body}".encode()
    der = subprocess.run(["openssl", "dgst", "-sha256", "-sign", KEY], input=msg, capture_output=True, check=True).stdout
    return f"{head}.{body}.{b64(der_to_raw(der))}"


def call(method: str, path: str, data=None):
    url = path if path.startswith("http") else "https://api.appstoreconnect.apple.com" + path
    req = urllib.request.Request(url, method=method, data=json.dumps(data).encode() if data is not None else None)
    req.add_header("Authorization", "Bearer " + token())
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, json.loads(raw) if raw else {}


if __name__ == "__main__":
    m, p = sys.argv[1].upper(), sys.argv[2]
    d = json.loads(sys.argv[3]) if len(sys.argv) > 3 else None
    status, out = call(m, p, d)
    print(json.dumps({"status": status, "body": out}, ensure_ascii=False, indent=1))
    sys.exit(0 if status < 400 else 1)
