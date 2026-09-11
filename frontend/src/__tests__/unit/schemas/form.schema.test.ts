import { step1Schema, step2Schema, step4Schema, step5Schema } from '../../../types/form'

// Jan 1 birthdays always count as "had this year", so age = currentYear - birthYear
const birthDateForAge = (age: number): string => `${new Date().getUTCFullYear() - age}-01-01`

describe('form schemas', () => {
  describe('step1 — identity', () => {
    const base = { first_name: 'Jane', last_name: 'Doe', instagram_handle: 'jane.doe_99', location: 'Paris' }

    it('accepts a valid handle and location', () => {
      expect(step1Schema.safeParse(base).success).toBe(true)
    })

    it('rejects an empty handle', () => {
      const r = step1Schema.safeParse({ ...base, instagram_handle: '' })
      expect(r.success).toBe(false)
    })

    it('rejects handles with spaces or special chars', () => {
      const r = step1Schema.safeParse({ ...base, instagram_handle: 'jane doe!' })
      expect(r.success).toBe(false)
    })

    it('rejects an empty location', () => {
      const r = step1Schema.safeParse({ ...base, location: '' })
      expect(r.success).toBe(false)
    })

    it('rejects an empty first name', () => {
      const r = step1Schema.safeParse({ ...base, first_name: '' })
      expect(r.success).toBe(false)
    })

    it('rejects an empty last name', () => {
      const r = step1Schema.safeParse({ ...base, last_name: '' })
      expect(r.success).toBe(false)
    })

    it('rejects a first name with digits or symbols', () => {
      const r = step1Schema.safeParse({ ...base, first_name: 'Jane99!' })
      expect(r.success).toBe(false)
    })

    it('accepts names with hyphens and apostrophes', () => {
      const r = step1Schema.safeParse({ ...base, first_name: "Anne-Marie", last_name: "O'Brien" })
      expect(r.success).toBe(true)
    })
  })

  describe('step2 — about you', () => {
    const base = {
      birth_date: birthDateForAge(25),
      work: 'Engineer',
      gender_identity: 'Male',
      sexual_orientation: 'Straight',
      religion: 'None',
    }

    it('accepts valid data', () => {
      expect(step2Schema.safeParse(base).success).toBe(true)
    })

    it('rejects a birth_date for someone under 18', () => {
      expect(step2Schema.safeParse({ ...base, birth_date: birthDateForAge(17) }).success).toBe(false)
    })

    it('rejects a birth_date for someone over 99', () => {
      expect(step2Schema.safeParse({ ...base, birth_date: birthDateForAge(100) }).success).toBe(false)
    })

    it('rejects a malformed birth_date', () => {
      expect(step2Schema.safeParse({ ...base, birth_date: '01/01/2000' }).success).toBe(false)
    })

    it('accepts optional height_cm when omitted', () => {
      expect(step2Schema.safeParse(base).success).toBe(true)
    })

    it('rejects height_cm below 100', () => {
      expect(step2Schema.safeParse({ ...base, height_cm: 99 }).success).toBe(false)
    })

    it('rejects height_cm above 250', () => {
      expect(step2Schema.safeParse({ ...base, height_cm: 251 }).success).toBe(false)
    })
  })

  describe('step4 — preferences', () => {
    const base = {
      relationship_type: 'Long Term' as const,
      open_to_long_distance: true,
      preferred_physical_traits: 'tall',
      preferred_character_traits: 'kind',
      deal_breakers: 'none',
      okay_with_opposite_gender_friends: true,
      religion_deal_breaker: false,
    }

    it('accepts a valid relationship type', () => {
      expect(step4Schema.safeParse(base).success).toBe(true)
    })

    it('rejects an invalid relationship type', () => {
      expect(step4Schema.safeParse({ ...base, relationship_type: 'Friends' }).success).toBe(false)
    })

    it('accepts all valid enum values', () => {
      const values = ['Long Term', 'Short Term', 'Open to Both', 'Casual', 'Not Sure'] as const
      for (const v of values) {
        expect(step4Schema.safeParse({ ...base, relationship_type: v }).success).toBe(true)
      }
    })
  })

  describe('step5 — final', () => {
    const base = {
      physical_affection_importance: 7,
      dream_first_date: 'Coffee and a walk',
      disclaimer_agreed: true as const,
    }

    it('accepts valid data', () => {
      expect(step5Schema.safeParse(base).success).toBe(true)
    })

    it('rejects disclaimer_agreed = false', () => {
      expect(step5Schema.safeParse({ ...base, disclaimer_agreed: false }).success).toBe(false)
    })

    it('rejects affection_importance below 1', () => {
      expect(step5Schema.safeParse({ ...base, physical_affection_importance: 0 }).success).toBe(false)
    })

    it('rejects affection_importance above 10', () => {
      expect(step5Schema.safeParse({ ...base, physical_affection_importance: 11 }).success).toBe(false)
    })

    it('rejects empty dream_first_date', () => {
      expect(step5Schema.safeParse({ ...base, dream_first_date: '' }).success).toBe(false)
    })
  })
})
