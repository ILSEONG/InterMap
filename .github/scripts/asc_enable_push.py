#!/usr/bin/env python3
"""앱 ID(번들 ID)에 Push Notifications 기능을 켠다 — 이미 켜져 있으면 아무것도 하지 않는다.

푸시 권한(aps-environment)을 실은 앱은 이 기능이 켜진 앱 ID의 프로파일로만 서명된다.
Apple 개발자 사이트에서 손으로 켜도 되지만, 빌드가 스스로 확인하고 켜 두면 빠뜨릴 일이 없다.

환경변수: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH(.p8 파일 경로), BUNDLE_ID(예: com.ilseong.intermap)
"""
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asc_revoke_ci_dev_certs import API, call, token  # noqa: E402

CAPABILITY = "PUSH_NOTIFICATIONS"


def main() -> int:
    identifier = os.environ["BUNDLE_ID"]
    jwt = token()
    try:
        found = call("GET", "/bundleIds?filter%5Bidentifier%5D=" + identifier + "&limit=200", jwt)["data"]
        # 필터는 "…로 시작하는 것"까지 돌려준다 — 정확히 같은 것만 고른다
        bundle = next((b for b in found if b["attributes"]["identifier"] == identifier), None)
        if bundle is None:
            print(f"::warning::앱 ID {identifier} 를 찾지 못했습니다 — 푸시 기능을 켜지 못했어요")
            return 0
        have = call("GET", "/bundleIds/" + bundle["id"] + "/bundleIdCapabilities?limit=200", jwt)["data"]
        if any(c["attributes"].get("capabilityType") == CAPABILITY for c in have):
            print("앱 ID에 Push Notifications가 이미 켜져 있습니다")
            return 0
        body = {
            "data": {
                "type": "bundleIdCapabilities",
                "attributes": {"capabilityType": CAPABILITY, "settings": []},
                "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": bundle["id"]}}},
            }
        }
        request = urllib.request.Request(
            API + "/bundleIdCapabilities",
            method="POST",
            data=json.dumps(body).encode(),
            headers={"Authorization": "Bearer " + jwt, "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=30):
            pass
        print("앱 ID에 Push Notifications를 켰습니다")
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:300]
        print(f"::warning::앱 ID의 푸시 기능을 확인하지 못했습니다 (HTTP {error.code}) {detail}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
