# API Key security migration rollback

This migration is data preserving. During rollback:

1. Set `API_KEY_LEGACY_AUTH_ENABLED=true`.
2. Keep all new columns and indexes. Do not copy hashes back into `tokens.key`.
3. Roll back application code only after every hashed-only key has been rotated
   to a credential format supported by the target version.
4. Never reconstruct or expose a cleared plaintext key. HMAC digests are not
   reversible.

After migration completion, disable legacy authentication only when the
remaining legacy count is zero and all database backups containing plaintext
keys have expired under the documented retention policy. Old backups must be
treated as active credential material until every affected key is rotated.
