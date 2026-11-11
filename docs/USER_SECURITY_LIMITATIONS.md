# User Security Limitations & Disclosures

**What you need to know about the security boundaries of Personal Digital Vault (PDV).**

---

### 1. What Zero-Knowledge Means

- **The server never knows your secrets:** All credentials, titles, notes, and file attachments are encrypted on your local device before being transmitted to the server.
- **The server operator cannot read your data:** Even with physical access to the backend database or cloud storage, the operator sees only opaque ciphertexts.

---

### 2. Loss of Keys is Irreversible

- **No Backdoors:** There is no "Forgot Password" link or administrative reset tool.
- **Both Keys Lost = Data Lost:** If you lose both your **Master Password** and your **256-bit Recovery Secret**, your vault is mathematically impossible to recover.
- **Action Required:** When creating a vault, write down your Recovery Secret on physical paper and store it in a secure, fireproof location.

---

### 3. Compromised Endpoint & Malware

- **Unlocked Device Risk:** If malware (such as a keylogger, trojan, or memory scraper) is running on your computer, it can intercept passwords as you type them or read them from computer memory while the vault is unlocked.
- **Auto-Lock Recommendation:** Always configure a reasonable Inactivity Auto-Lock timeout in **Settings** (e.g. 5 or 15 minutes), especially on laptops and portable computers.

---

### 4. Clipboard Safety

- **Clipboard Snooping:** When you copy a password or username to your clipboard, other applications running on your machine may read the clipboard.
- **Automatic Clearing:** PDV provides an automatic clipboard clear feature. Never leave sensitive credentials in your clipboard unattended.

---

### 5. Local Browser Storage

- **Browser Databases are Not Backups:** The local browser storage (IndexedDB) is a cache designed for fast access and offline use. Modern browsers may evict local data if storage is full or if you clear site data.
- **Export Regular Backups:** Regularly export an Encrypted Backup Archive (`.pdvbackup`) via the **Recovery & Backup** tab and store it on an external drive or secure cloud storage.

---

### 6. Deletions and External Backups

- **Offline Files Persist:** Deleting a password, a vault, or your account on the server does not modify or delete offline `.pdvbackup` packages you previously saved. You must manually delete offline backup files if you wish them purged.
- **Tombstones:** Deleted records are kept as deletion tombstones for 30 days to ensure other devices that come online later learn that the record was deleted.

---

### 7. Metadata Visibility

- While the content of your vault is strictly encrypted, network observers and server operators can observe:
  - The IP address from which you connect.
  - The exact timestamps of your connections and synchronizations.
  - The total byte size and count of encrypted objects and file attachments.
  - Your registered account email address.
