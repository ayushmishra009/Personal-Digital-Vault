import React, { useEffect, useState, useTransition } from "react";
import {
  AccountSession,
  Device,
  getSession,
  loginAccount,
  logoutAccount,
  registerAccount,
  listDevices,
  approveDeviceEnrollment,
  revokeDevice,
  createDeviceEnrollment,
} from "./api";

function randomBase64Url(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function App() {
  const [session, setSession] = useState<AccountSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);

  const [tab, setTab] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("My Browser");
  const [deviceId, setDeviceId] = useState("");
  const [credentialId, setCredentialId] = useState("");

  const [enrollEnrollmentId, setEnrollEnrollmentId] = useState("");
  const [enrollLabel, setEnrollLabel] = useState("Second Device (Mobile)");
  const [latestChallenge, setLatestChallenge] = useState<string | null>(null);

  const [, startTransition] = useTransition();

  const refreshSession = async () => {
    try {
      setLoading(true);
      setError(null);
      const s = await getSession();
      setSession(s);
      if (s && s.device?.status === "active") {
        const devList = await listDevices();
        setDevices(devList.items);
      } else {
        setDevices([]);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshSession();
  }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const generatedPubKey = randomBase64Url(32);
      const generatedCredId = credentialId.trim() || `cred-${Date.now()}`;
      const s = await registerAccount({
        email: email.trim(),
        deviceLabel: deviceLabel.trim() || "Web Browser",
        platform: navigator.platform || "Web",
        browser: "Chrome / Modern Browser",
        publicKeyAlgorithm: "Ed25519",
        publicKey: generatedPubKey,
        credentialType: "external",
        credentialId: generatedCredId,
      });
      startTransition(() => {
        setSession(s);
        if (s.device?.id) setDeviceId(s.device.id);
      });
      const devList = await listDevices();
      setDevices(devList.items);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const s = await loginAccount({
        email: email.trim(),
        deviceId: deviceId.trim(),
        credentialType: "external",
        credentialId: credentialId.trim(),
      });
      startTransition(() => {
        setSession(s);
      });
      if (s.device?.status === "active") {
        const devList = await listDevices();
        setDevices(devList.items);
      }
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutAccount();
      setSession(null);
      setDevices([]);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleCreateEnrollment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const pubKey = randomBase64Url(32);
      const res = await createDeviceEnrollment({
        deviceLabel: enrollLabel,
        platform: "Mobile / Secondary",
        browser: "Browser Client",
        publicKeyAlgorithm: "Ed25519",
        publicKey: pubKey,
      });
      setLatestChallenge(
        `Enrollment ID: ${res.id}\nChallenge: ${res.challenge}`,
      );
      const devList = await listDevices();
      setDevices(devList.items);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleApproveEnrollment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollEnrollmentId.trim()) return;
    setError(null);
    try {
      const sig = randomBase64Url(64);
      await approveDeviceEnrollment(enrollEnrollmentId.trim(), "Ed25519", sig);
      setEnrollEnrollmentId("");
      const devList = await listDevices();
      setDevices(devList.items);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleRevoke = async (targetId: string) => {
    if (
      !confirm(
        "Are you sure you want to revoke this device? Its sessions will be terminated immediately.",
      )
    ) {
      return;
    }
    setError(null);
    try {
      await revokeDevice(targetId);
      const devList = await listDevices();
      setDevices(devList.items);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    }
  };

  if (loading) {
    return (
      <main>
        <p className="eyebrow">Personal Digital Vault</p>
        <h1>Loading session...</h1>
      </main>
    );
  }

  return (
    <main>
      <header className="header">
        <div>
          <p className="eyebrow">Personal Digital Vault</p>
          <h1>Account & Device Foundation</h1>
        </div>
        {session && (
          <button className="secondary-btn" onClick={handleLogout}>
            Sign Out
          </button>
        )}
      </header>

      {error && <div className="error-banner">{error}</div>}

      {!session ? (
        <section className="card">
          <div className="tab-bar">
            <button
              className={`tab-btn ${tab === "register" ? "active" : ""}`}
              onClick={() => setTab("register")}
            >
              Create Account
            </button>
            <button
              className={`tab-btn ${tab === "login" ? "active" : ""}`}
              onClick={() => setTab("login")}
            >
              Sign In
            </button>
          </div>

          {tab === "register" ? (
            <form onSubmit={handleRegister} className="form">
              <label>
                Account Email
                <input
                  type="email"
                  required
                  placeholder="user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>

              <label>
                Initial Device Name
                <input
                  type="text"
                  required
                  placeholder="Work Laptop"
                  value={deviceLabel}
                  onChange={(e) => setDeviceLabel(e.target.value)}
                />
              </label>

              <label>
                Auth Credential Identifier
                <input
                  type="text"
                  placeholder="Leave empty for auto-generated ID"
                  value={credentialId}
                  onChange={(e) => setCredentialId(e.target.value)}
                />
              </label>

              <button type="submit" className="primary-btn">
                Register & Enroll Device
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="form">
              <label>
                Account Email
                <input
                  type="email"
                  required
                  placeholder="user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>

              <label>
                Registered Device ID (UUID)
                <input
                  type="text"
                  required
                  placeholder="e.g. dev-0001"
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                />
              </label>

              <label>
                Credential Identifier
                <input
                  type="text"
                  required
                  placeholder="e.g. cred-user-001"
                  value={credentialId}
                  onChange={(e) => setCredentialId(e.target.value)}
                />
              </label>

              <button type="submit" className="primary-btn">
                Sign In
              </button>
            </form>
          )}
        </section>
      ) : session.device?.status === "pending" ? (
        <section className="card pending-card">
          <h2>Device Approval Pending</h2>
          <p className="notice">
            This device has authenticated to{" "}
            <strong>{session.account.email}</strong>, but requires cryptographic
            authorization from one of your existing active devices before
            accessing vault data.
          </p>
          <div className="status-badge pending">Status: Pending Approval</div>
          <button className="primary-btn" onClick={refreshSession}>
            Check Approval Status
          </button>
        </section>
      ) : (
        <div>
          <section className="card info-card">
            <h2>Account Overview</h2>
            <div className="meta-grid">
              <div>
                <span className="meta-label">Account ID:</span>
                <code>{session.account.id}</code>
              </div>
              <div>
                <span className="meta-label">Email:</span>
                <span>{session.account.email}</span>
              </div>
              <div>
                <span className="meta-label">Current Device:</span>
                <span>
                  {session.device?.label} ({session.device?.platform}) —{" "}
                  <strong className="active-text">
                    {session.device?.status}
                  </strong>
                </span>
              </div>
            </div>
          </section>

          <section className="card">
            <h2>Authorized Devices ({devices.length})</h2>
            <div className="device-list">
              {devices.map((d) => (
                <div key={d.id} className="device-item">
                  <div>
                    <strong>{d.label}</strong>
                    <div className="device-meta">
                      {d.platform} • {d.browser} • ID: <code>{d.id}</code>
                    </div>
                  </div>
                  <div className="device-actions">
                    <span className={`status-badge ${d.status}`}>
                      {d.status}
                    </span>
                    {d.id !== session.device?.id && d.status === "active" && (
                      <button
                        className="danger-btn"
                        onClick={() => handleRevoke(d.id)}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>Enroll Another Device</h2>
            <form onSubmit={handleCreateEnrollment} className="form-inline">
              <input
                type="text"
                placeholder="New Device Name (e.g. iPad)"
                value={enrollLabel}
                onChange={(e) => setEnrollLabel(e.target.value)}
              />
              <button type="submit" className="primary-btn">
                Start Enrollment Challenge
              </button>
            </form>
            {latestChallenge && (
              <pre className="challenge-box">{latestChallenge}</pre>
            )}
          </section>

          <section className="card">
            <h2>Approve Pending Enrollment</h2>
            <form onSubmit={handleApproveEnrollment} className="form-inline">
              <input
                type="text"
                placeholder="Enter Enrollment ID to approve"
                value={enrollEnrollmentId}
                onChange={(e) => setEnrollEnrollmentId(e.target.value)}
              />
              <button type="submit" className="primary-btn">
                Approve Device
              </button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
