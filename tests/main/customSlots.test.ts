import { describe, expect, it } from 'vitest'
import {
  getCustomSlotNumberFromKey,
  getHighestCustomSlot,
  getHighestReferencedCustomSlot
} from '../../src/shared/domain/slots'

// Before #692 this walker was copied three times (renderer lib/config.ts, main
// migrator.ts, main ipc/config.ts) in two flavours: an "in use" scan that sizes
// the visible slot count, and a "referenced" scan that widens the save-time
// sanitizer whitelist. The two must stay distinct - collapsing the referenced
// scan into the in-use one silently drops referenced-but-disabled slots on save.

describe('getCustomSlotNumberFromKey', () => {
  it('parses customapp<N> keys and rejects everything else', () => {
    expect(getCustomSlotNumberFromKey('customapp1')).toBe(1)
    expect(getCustomSlotNumberFromKey('customapp20')).toBe(20)
    expect(getCustomSlotNumberFromKey('simhub')).toBeNull()
    expect(getCustomSlotNumberFromKey('customapp')).toBeNull()
    expect(getCustomSlotNumberFromKey('customappX')).toBeNull()
    expect(getCustomSlotNumberFromKey('xcustomapp1')).toBeNull()
  })
})

describe('getHighestCustomSlot (in use)', () => {
  it('counts only slots with an active value across flat records', () => {
    expect(
      getHighestCustomSlot({
        customapp1: 'C:/Tools/A.exe', // configured path
        customapp2: true, // legacy enabled flag
        customapp3: false, // disabled
        customapp4: '   ' // whitespace-only, treated as empty
      })
    ).toBe(2)
  })

  it('counts enabled utilities inside a nested profile set, ignoring disabled', () => {
    const profileSet = {
      activeProfileId: 'default',
      profiles: [
        {
          id: 'default',
          name: 'Default',
          utilities: [
            { id: 'customapp5', enabled: true },
            { id: 'customapp7', enabled: false }
          ]
        }
      ]
    }
    expect(getHighestCustomSlot(profileSet)).toBe(5)
  })

  it('takes the max across all provided records and returns 0 for none', () => {
    expect(getHighestCustomSlot({ customapp2: true }, { customapp6: 'C:/x.exe' })).toBe(6)
    expect(getHighestCustomSlot(undefined, {})).toBe(0)
  })
})

describe('getHighestReferencedCustomSlot (referenced, widens whitelist)', () => {
  it('counts referenced-but-disabled slots that the in-use scan ignores', () => {
    const profileSet = {
      activeProfileId: 'default',
      profiles: [
        {
          id: 'default',
          name: 'Default',
          customapp5: false, // referenced by key, value false
          utilities: [{ id: 'customapp6', enabled: false }] // referenced, disabled
        }
      ]
    }

    // Referenced: any mention widens the whitelist so the slot survives save.
    expect(getHighestReferencedCustomSlot(profileSet)).toBe(6)
    // In use: the disabled references are not active, so they do not count. This
    // is the exact divergence #692 must preserve - if the referenced scan is ever
    // reduced to the in-use scan, the assertion above drops to 0 and fails here.
    expect(getHighestCustomSlot(profileSet)).toBe(0)
  })

  it('does not clamp - callers apply MAX_CUSTOM_SLOTS', () => {
    const profileSet = {
      activeProfileId: 'default',
      profiles: [
        {
          id: 'default',
          name: 'Default',
          utilities: [{ id: 'customapp99', enabled: false }]
        }
      ]
    }
    expect(getHighestReferencedCustomSlot(profileSet)).toBe(99)
  })
})
