// Tracks how many of the trunk's simultaneous-call channels are in use.
// Every call — inbound or outbound, single or one leg of a multi-line
// round — holds one lease for its whole life. The limit comes from
// SIP_MAX_CHANNELS, so going from VoIPcloud's 1-channel plan to N
// channels is a config change, not a code change.
export class ChannelPool {
  constructor(max) {
    this.max = Math.max(1, max | 0);
    this.leases = new Set();
  }

  get inUse() {
    return this.leases.size;
  }

  get available() {
    return Math.max(0, this.max - this.leases.size);
  }

  // Returns a lease (call lease.release() when the call ends) or null
  // when every channel is busy.
  tryAcquire(label) {
    if (this.leases.size >= this.max) return null;
    const lease = {
      label,
      acquiredAt: Date.now(),
      release: () => this.leases.delete(lease),
    };
    this.leases.add(lease);
    return lease;
  }

  snapshot() {
    return {
      max: this.max,
      inUse: this.inUse,
      available: this.available,
      calls: [...this.leases].map((l) => l.label),
    };
  }
}
