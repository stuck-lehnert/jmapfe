import { CAP_CORE, isStandardCapability } from "./constants.ts"
import type { Capability, JmapSession } from "./types.ts"

export interface CapabilityAdapter {
  readonly capability: Capability
}

export class CapabilityRegistry {
  private readonly adapters = new Map<Capability, CapabilityAdapter>()

  register(adapter: CapabilityAdapter): void {
    this.adapters.set(adapter.capability, adapter)
  }

  hasAdapter(capability: Capability): boolean {
    return this.adapters.has(capability)
  }

  negotiate(session: JmapSession, requested: readonly Capability[]): Capability[] {
    const advertised = new Set(Object.keys(session.capabilities))
    const using: Capability[] = []

    for (const capability of requested) {
      if (!advertised.has(capability)) continue
      if (!isStandardCapability(capability) && !this.hasAdapter(capability)) continue
      if (!using.includes(capability)) using.push(capability)
    }

    if (advertised.has(CAP_CORE) && !using.includes(CAP_CORE)) using.unshift(CAP_CORE)
    return using
  }
}

export const standardCapabilityRegistry = new CapabilityRegistry()
