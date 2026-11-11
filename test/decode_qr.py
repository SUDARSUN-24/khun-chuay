"""
Independent check of the PromptPay QR codes (run: npm run test:qr).

1. Scan each PNG with OpenCV's QR reader (not the library that drew it).
2. Parse the EMVCo fields from scratch and check them against what we meant.
3. Recompute the CRC with Python's built-in binascii.crc_hqx.
"""
import binascii
import json
import os
import sys

import cv2

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")


def parse_tlv(s):
    fields, i = {}, 0
    while i < len(s):
        tag, length = s[i:i + 2], int(s[i + 2:i + 4])
        fields[tag] = s[i + 4:i + 4 + length]
        i += 4 + length
    return fields


def main():
    manifest = json.load(open(os.path.join(OUT, "manifest.json"), encoding="utf-8"))
    detector = cv2.QRCodeDetector()
    failures = 0
    for case in manifest:
        img = cv2.imread(os.path.join(OUT, case["name"] + ".png"))
        text, _, _ = detector.detectAndDecode(img)
        problems = []
        if text != case["payload"]:
            problems.append(f"scanned {text!r}")
        else:
            f = parse_tlv(text)
            acct = parse_tlv(f["29"])
            body, crc = text[:-4], text[-4:]
            if f"{binascii.crc_hqx(body.encode(), 0xFFFF):04X}" != crc:
                problems.append("bad CRC")
            if acct.get("00") != "A000000677010111":
                problems.append("not a PromptPay AID")
            if f.get("58") != "TH" or f.get("53") != "764":
                problems.append("wrong country/currency")
            t = case["target"]
            want = ("01", "0066" + t[1:]) if len(t) == 10 else ("02", t) if len(t) == 13 else ("03", t)
            if acct.get(want[0]) != want[1]:
                problems.append(f"wrong account {acct}")
            if case["amount"] is None:
                if "54" in f or f["01"] != "11":
                    problems.append("should be a reusable QR without amount")
            elif f.get("54") != f"{case['amount']:.2f}" or f["01"] != "12":
                problems.append(f"amount {f.get('54')}")
        status = "PASS" if not problems else "FAIL " + "; ".join(problems)
        failures += bool(problems)
        print(f"{status:5} {case['name']:18} {text[:60]}...")
    print("all QR codes scan correctly" if not failures else f"{failures} failed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
