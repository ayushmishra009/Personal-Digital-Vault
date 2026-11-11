import React, { useState } from "react";
import type { Device } from "../api";

interface DevicesViewProps {
  devices: Device[];
  currentDeviceId?: string;
  onApproveDevice: (enrollmentId: string, challenge: string) => Promise<void>;
  onRevokeDevice: (deviceId: string) => Promise<void>;
  onCreateEnrollment: (label: string) => Promise<string | null>;
}

export const DevicesView: React.FC<DevicesViewProps> = ({
  devices,
  currentDeviceId,
  onApproveDevice,
  onRevokeDevice,
  onCreateEnrollment,
}) => {
  const [showPairModal, setShowPairModal] = useState(false);
  const [newDeviceLabel, setNewDeviceLabel] = useState("Mobile Device");
  const [latestChallenge, setLatestChallenge] = useState<string | null>(null);
  const [approveInput, setApproveInput] = useState({
    enrollmentId: "",
    challenge: "",
  });
  const [showApproveModal, setShowApproveModal] = useState(false);

  const activeDevices = devices.filter((d) => d.status === "active");
  const pendingDevices = devices.filter((d) => d.status === "pending");

  const handleStartPairing = async (e: React.FormEvent) => {
    e.preventDefault();
    const challenge = await onCreateEnrollment(newDeviceLabel);
    if (challenge) {
      setLatestChallenge(challenge);
    }
  };

  const handleApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approveInput.enrollmentId.trim() || !approveInput.challenge.trim())
      return;
    await onApproveDevice(
      approveInput.enrollmentId.trim(),
      approveInput.challenge.trim(),
    );
    setShowApproveModal(false);
    setApproveInput({ enrollmentId: "", challenge: "" });
  };

  return (
    <div className="view-container">
      <div className="view-header">
        <div>
          <h2>Device Management ({activeDevices.length} Active)</h2>
          <p className="view-subtitle">
            Authorize and manage trusted hardware and browser endpoints with
            cryptographic challenge pairing.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowApproveModal(true)}
          >
            ✓ Approve Device
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowPairModal(true)}
          >
            + Enroll Device
          </button>
        </div>
      </div>

      {pendingDevices.length > 0 && (
        <div
          className="card"
          style={{ borderLeft: "2px solid var(--xai-accent-sunset, #ff7a17)", marginBottom: "1.5rem" }}
        >
          <h3
            style={{
              margin: "0 0 0.5rem",
              fontSize: "1.1rem",
              color: "var(--xai-accent-sunset, #ff7a17)",
            }}
          >
            ⚠️ Pending Device Enrollments ({pendingDevices.length})
          </h3>
          <p
            style={{
              margin: "0 0 1rem",
              fontSize: "0.85rem",
              color: "var(--xai-body, #dadbdf)",
            }}
          >
            These devices have authenticated with account credentials but
            require explicit cryptographic approval from this active device
            before they can read vault ciphertext.
          </p>
          <div className="card-table-wrapper">
            <table className="card-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Platform / Browser</th>
                  <th>Enrolled</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingDevices.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.label}</strong>
                      <div style={{ fontSize: "0.75rem", color: "var(--xai-mute, #7d8187)", fontFamily: "var(--font-mono)" }}>
                        {d.id}
                      </div>
                    </td>
                    <td>
                      {d.platform} • {d.browser}
                    </td>
                    <td>{new Date(d.createdAt).toLocaleDateString()}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => {
                          setApproveInput({ enrollmentId: "", challenge: "" });
                          setShowApproveModal(true);
                        }}
                      >
                        Approve
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Active Devices Table */}
      <div className="card">
        <h3 style={{ margin: "0 0 1rem", fontSize: "1.1rem" }}>
          Authorized Devices
        </h3>
        <table className="card-table">
          <thead>
            <tr>
              <th>Device Label</th>
              <th>Platform</th>
              <th>Browser</th>
              <th>Status</th>
              <th>Enrolled Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {activeDevices.map((d) => {
              const isCurrent = d.id === currentDeviceId;
              return (
                <tr key={d.id}>
                  <td>
                    <strong>{d.label}</strong>
                    {isCurrent && (
                      <span
                        className="badge badge-screen"
                        style={{ marginLeft: "0.5rem" }}
                      >
                        Current Device
                      </span>
                    )}
                    <div style={{ fontSize: "0.75rem", color: "var(--xai-mute, #7d8187)", fontFamily: "var(--font-mono)" }}>
                      {d.id}
                    </div>
                  </td>
                  <td>{d.platform}</td>
                  <td>{d.browser}</td>
                  <td>
                    <span className="badge badge-active">Active</span>
                  </td>
                  <td>{new Date(d.createdAt).toLocaleDateString()}</td>
                  <td>
                    {!isCurrent && (
                      <button
                        type="button"
                        className="danger-btn btn-sm"
                        style={{
                          padding: "0.25rem 0.65rem",
                          fontSize: "0.78rem",
                        }}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Revoke device "${d.label}"? All sessions for this device will be immediately terminated.`,
                            )
                          ) {
                            onRevokeDevice(d.id);
                          }
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* MODAL: ENROLL DEVICE */}
      {showPairModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <h3>Enroll a Secondary Device</h3>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setShowPairModal(false);
                  setLatestChallenge(null);
                }}
              >
                ✕
              </button>
            </div>

            {latestChallenge ? (
              <div>
                <p style={{ fontSize: "0.9rem", color: "var(--xai-mute, #7d8187)" }}>
                  A pairing challenge was created. Enter this challenge and
                  Enrollment ID on the new device:
                </p>
                <div
                  className="secret-display font-mono"
                  style={{ fontSize: "1.1rem", textAlign: "center" }}
                >
                  {latestChallenge}
                </div>
                <p
                  style={{
                    fontSize: "0.8rem",
                    color: "var(--xai-mute, #7d8187)",
                    marginTop: "0.5rem",
                  }}
                >
                  ⏳ This pairing challenge is single-use and expires in 10
                  minutes.
                </p>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => {
                      setShowPairModal(false);
                      setLatestChallenge(null);
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleStartPairing}>
                <div className="form-group">
                  <label>Device Name / Description</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. iPhone, Work MacBook"
                    value={newDeviceLabel}
                    onChange={(e) => setNewDeviceLabel(e.target.value)}
                    required
                  />
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setShowPairModal(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    Generate Pairing Code
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* MODAL: APPROVE DEVICE */}
      {showApproveModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <h3>Cryptographically Approve Enrollment</h3>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowApproveModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleApprove}>
              <div className="form-group">
                <label>Enrollment ID (from pending device)</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. enr-0001"
                  value={approveInput.enrollmentId}
                  onChange={(e) =>
                    setApproveInput({
                      ...approveInput,
                      enrollmentId: e.target.value,
                    })
                  }
                  required
                />
              </div>

              <div className="form-group">
                <label>Pairing Challenge</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Base64url pairing challenge"
                  value={approveInput.challenge}
                  onChange={(e) =>
                    setApproveInput({
                      ...approveInput,
                      challenge: e.target.value,
                    })
                  }
                  required
                />
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowApproveModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Sign & Authorize Device
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
