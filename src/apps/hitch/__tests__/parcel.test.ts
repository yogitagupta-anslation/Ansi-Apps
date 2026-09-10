/**
 * Sending a thing instead of a person.
 *
 * The rules under test are the ones the flow would be unsafe or useless without: a bike
 * cannot take a carton, a parcel is priced for the space it occupies, and every delivery
 * gets a handover code — because with no server and no tracking, that code is the whole
 * of the proof that the right person received it.
 */
import {
  CARRY_LIMIT_KG,
  PARCEL_SIZES,
  PROHIBITED,
  canCarry,
  estimateParcelFare,
  handoverCode,
  parcelSizeSpec,
} from '../config/parcel';
import {estimateFare} from '../services/routing';

describe('what each vehicle will carry', () => {
  it('lets a bike take documents but not a carton', () => {
    // Rapido's own bike limit is 5 kg, and it exists because the rider holds the parcel.
    expect(canCarry('bike', 'small')).toBe(true);
    expect(canCarry('bike', 'medium')).toBe(true);
    expect(canCarry('bike', 'large')).toBe(false);
  });

  it('lets an auto and a cab take anything on the list', () => {
    for (const size of PARCEL_SIZES) {
      expect(canCarry('auto', size.id)).toBe(true);
      expect(canCarry('cab', size.id)).toBe(true);
    }
  });

  it('keeps every size within the limit of at least one vehicle', () => {
    // A size nothing can carry would be an option that always dead-ends at the kerb.
    for (const size of PARCEL_SIZES) {
      const carriers = (['bike', 'auto', 'cab'] as const).filter(k => canCarry(k, size.id));
      expect(carriers.length).toBeGreaterThan(0);
    }
  });

  it('orders the limits the way the vehicles are actually sized', () => {
    expect(CARRY_LIMIT_KG.bike).toBeLessThan(CARRY_LIMIT_KG.auto);
    expect(CARRY_LIMIT_KG.auto).toBeLessThanOrEqual(CARRY_LIMIT_KG.cab);
  });
});

describe('parcel fares', () => {
  it('costs less than putting a person in the same vehicle', () => {
    // A rider carrying a bag is not a rider carrying a passenger, and the two price
    // differently — Ola Parcel starts well under a passenger fare for the same distance.
    for (const kind of ['bike', 'auto', 'cab'] as const) {
      expect(estimateParcelFare(kind, 6, 'small')).toBeLessThan(estimateFare(kind, 6));
    }
  });

  it('charges more for a bigger parcel on the same vehicle', () => {
    // It is the space being sold.
    const small = estimateParcelFare('auto', 8, 'small');
    const medium = estimateParcelFare('auto', 8, 'medium');
    const large = estimateParcelFare('auto', 8, 'large');
    expect(medium).toBeGreaterThan(small);
    expect(large).toBeGreaterThan(medium);
  });

  it('rises with distance and stays rounded', () => {
    expect(estimateParcelFare('bike', 12, 'small')).toBeGreaterThan(
      estimateParcelFare('bike', 3, 'small'),
    );
    for (const km of [1.2, 5.6, 9.9, 14.3]) {
      expect(estimateParcelFare('bike', km, 'small') % 5).toBe(0);
    }
  });

  it('ranks the vehicles the same way a ride does', () => {
    const km = 7;
    expect(estimateParcelFare('bike', km, 'small')).toBeLessThan(
      estimateParcelFare('auto', km, 'small'),
    );
    expect(estimateParcelFare('auto', km, 'small')).toBeLessThan(
      estimateParcelFare('cab', km, 'small'),
    );
  });
});

describe('the handover code', () => {
  it('is four digits, because it has to be said across a doorway', () => {
    for (let i = 0; i < 200; i++) {
      expect(handoverCode()).toMatch(/^\d{4}$/);
    }
  });

  it('never starts with a zero, which is lost when a code is read aloud', () => {
    for (let i = 0; i < 200; i++) {
      expect(handoverCode().startsWith('0')).toBe(false);
    }
  });

  it('is not the same number every time', () => {
    const seen = new Set(Array.from({length: 200}, () => handoverCode()));
    expect(seen.size).toBeGreaterThan(50);
  });
});

describe('what a sender is asked to confirm', () => {
  it('names specific things rather than pointing at terms and conditions', () => {
    // The point is two seconds of actual thought about what is in the bag. A wall of
    // legal text gets agreed to without being read, which is the same as not asking.
    expect(PROHIBITED.length).toBeGreaterThanOrEqual(4);
    expect(PROHIBITED.length).toBeLessThanOrEqual(8);
    for (const item of PROHIBITED) {
      expect(item.length).toBeLessThan(60);
    }
  });
});

describe('parcel sizes', () => {
  it('describes each one with something you can picture', () => {
    for (const size of PARCEL_SIZES) {
      expect(size.example.length).toBeGreaterThan(5);
      expect(size.maxKg).toBeGreaterThan(0);
    }
  });

  it('orders them by weight', () => {
    const weights = PARCEL_SIZES.map(s => s.maxKg);
    expect([...weights].sort((a, b) => a - b)).toEqual(weights);
  });

  it('falls back rather than throwing on an unknown size', () => {
    expect(parcelSizeSpec('nonsense' as never)).toBeDefined();
  });
});
