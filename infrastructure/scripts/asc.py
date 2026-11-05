#!/usr/bin/env python3
"""Minimal App Store Connect API client (no third-party deps; ES256 via openssl).

Env: ASC_KEY_ID, ASC_ISSUER_ID; key file ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8
Usage:
  asc.py GET  /v1/apps?filter[bundleId]=com.mizibu.retfast
  asc.py POST /v1/... '{"data": ...}'
  asc.py PATCH /v1/... '{"data": ...}'
  asc.py distribute <build-number> [--group <betaGroupId>]   # wait for processing, add to internal testers
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


APP_ID = os.environ.get("ASC_APP_ID", "6806568906")
INTERNAL_GROUP = os.environ.get("ASC_INTERNAL_GROUP", "b12f437c-335b-4418-b12d-28cf5adc1921")


def distribute(build_number: str, group: str, timeout_s: int = 3600) -> int:
    """Wait until the uploaded build is processed, then add it to the beta group."""
    from urllib.parse import quote
    q = f"/v1/builds?filter[app]={APP_ID}&filter[version]={quote(build_number)}&limit=1"
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        status, out = call("GET", q)
        data = out.get("data", []) if status == 200 else []
        state = data[0]["attributes"]["processingState"] if data else "NOT_FOUND_YET"
        print(time.strftime("%H:%M:%S"), build_number, state, flush=True)
        if state == "VALID":
            bid = data[0]["id"]
            st, _ = call("POST", f"/v1/betaGroups/{group}/relationships/builds", {"data": [{"type": "builds", "id": bid}]})
            st2, det = call("GET", f"/v1/builds/{bid}/buildBetaDetail")
            print("added to group:", st, "internal state:", det.get("data", {}).get("attributes", {}).get("internalBuildState"))
            return 0 if st in (200, 204) else 1
        if state in ("FAILED", "INVALID"):
            return 1
        time.sleep(60)
    print("timed out")
    return 1


if __name__ == "__main__":
    if sys.argv[1] == "distribute":
        g = sys.argv[sys.argv.index("--group") + 1] if "--group" in sys.argv else INTERNAL_GROUP
        sys.exit(distribute(sys.argv[2], g))
    m, p = sys.argv[1].upper(), sys.argv[2]
    d = json.loads(sys.argv[3]) if len(sys.argv) > 3 else None
    status, out = call(m, p, d)
    print(json.dumps({"status": status, "body": out}, ensure_ascii=False, indent=1))
    sys.exit(0 if status < 400 else 1)
