#!/usr/bin/env python3
"""CI가 만든 Apple 개발 인증서를 지운다.

GitHub 맥 서버는 매번 새 컴퓨터라, 자동 서명으로 빌드하면 Xcode가 실행할 때마다
"Apple Development: Created via API" 인증서를 새로 만든다. 쌓이면 개수 한도에 걸려 빌드가 막히므로
업로드가 끝나면 지운다. 스토어 배포용 인증서는 Apple이 클라우드에서 관리해서 건드리지 않는다.

환경변수: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH(.p8 파일 경로)
표준 라이브러리와 openssl만 쓴다.
"""
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "https://api.appstoreconnect.apple.com/v1"


def b64url(raw: bytes) -> bytes:
    return base64.urlsafe_b64encode(raw).rstrip(b"=")


def der_to_raw(der: bytes) -> bytes:
    """openssl이 내는 ECDSA 서명(DER)을 JWT가 쓰는 R||S 64바이트로 바꾼다."""
    i = 2 if der[1] < 0x80 else 2 + (der[1] & 0x7F)
    parts = []
    for _ in range(2):
        if der[i] != 0x02:
            raise ValueError("서명 형식이 예상과 다릅니다")
        length = der[i + 1]
        parts.append(der[i + 2 : i + 2 + length].lstrip(b"\x00").rjust(32, b"\x00"))
        i += 2 + length
    return parts[0] + parts[1]


def token() -> str:
    now = int(time.time())
    header = b64url(json.dumps({"alg": "ES256", "kid": os.environ["ASC_KEY_ID"], "typ": "JWT"}).encode())
    claims = b64url(
        json.dumps({"iss": os.environ["ASC_ISSUER_ID"], "iat": now, "exp": now + 600, "aud": "appstoreconnect-v1"}).encode()
    )
    unsigned = header + b"." + claims
    der = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", os.environ["ASC_KEY_PATH"]],
        input=unsigned,
        capture_output=True,
        check=True,
    ).stdout
    return (unsigned + b"." + b64url(der_to_raw(der))).decode()


def call(method: str, path: str, jwt: str):
    request = urllib.request.Request(API + path, method=method, headers={"Authorization": "Bearer " + jwt})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read()
        return json.loads(body) if body else None


def main() -> int:
    jwt = token()
    try:
        certs = call("GET", "/certificates?filter%5BcertificateType%5D=DEVELOPMENT&limit=200", jwt)["data"]
    except urllib.error.HTTPError as error:
        print(f"인증서 목록을 읽지 못했습니다 (HTTP {error.code}) — 정리를 건너뜁니다")
        return 0
    mine = [c for c in certs if "Created via API" in (c["attributes"].get("name") or "")]
    print(f"개발 인증서 {len(certs)}개 중 CI가 만든 것 {len(mine)}개")
    for cert in mine:
        try:
            call("DELETE", "/certificates/" + cert["id"], jwt)
            print("  지움:", cert["attributes"].get("name"))
        except urllib.error.HTTPError as error:
            print(f"  못 지움 (HTTP {error.code}):", cert["attributes"].get("name"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
