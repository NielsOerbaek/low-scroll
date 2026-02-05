import json
import os
from base64 import b64encode, b64decode
from hashlib import sha256
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding
from src.db import Database


class CookieManager:
    def __init__(self, db: Database, encryption_key: str):
        self.db = db
        key_bytes = bytes.fromhex(encryption_key)
        self._key = sha256(key_bytes).digest()  # 32 bytes for AES-256

    def _encrypt(self, plaintext: str) -> str:
        iv = os.urandom(16)
        padder = padding.PKCS7(128).padder()
        padded = padder.update(plaintext.encode()) + padder.finalize()
        cipher = Cipher(algorithms.AES(self._key), modes.CBC(iv))
        encryptor = cipher.encryptor()
        encrypted = encryptor.update(padded) + encryptor.finalize()
        return b64encode(iv + encrypted).decode()

    def _decrypt(self, token: str) -> str:
        data = b64decode(token)
        iv = data[:16]
        encrypted = data[16:]
        cipher = Cipher(algorithms.AES(self._key), modes.CBC(iv))
        decryptor = cipher.decryptor()
        padded = decryptor.update(encrypted) + decryptor.finalize()
        unpadder = padding.PKCS7(128).unpadder()
        return (unpadder.update(padded) + unpadder.finalize()).decode()

    def store_cookies(self, cookies: dict[str, str]):
        encrypted = self._encrypt(json.dumps(cookies))
        self.db.set_config("ig_cookies", encrypted)
        self.db.set_config("ig_cookies_stale", "false")

    def get_cookies(self) -> dict[str, str] | None:
        encrypted = self.db.get_config("ig_cookies")
        if not encrypted:
            return None
        plaintext = self._decrypt(encrypted)
        return json.loads(plaintext)

    def mark_stale(self):
        self.db.set_config("ig_cookies_stale", "true")

    def is_stale(self) -> bool:
        return self.db.get_config("ig_cookies_stale") == "true"
