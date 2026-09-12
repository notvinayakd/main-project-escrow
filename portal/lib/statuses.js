// The consignment lifecycle, and who may move it.
// PORTAL_SPEC.md section 2.4 is the contract; this file implements it.
//
// Two independent permission questions, deliberately kept apart:
//   canTransition  -- is this move legal for the consignment, whoever is asking?
//   canActorSet    -- may THIS person, in THIS role, at THIS station, make that move?
// Separating them means an error can say which rule was broken.

const FLOW = ['booking_confirmed', 'documents_lodged', 'dispatched', 'customs_cleared'];
const HELD = 'held';
const CANCELLED = 'cancelled';
const ALL = [...FLOW, CANCELLED, HELD];

const STATUS_CODES = {
  booking_confirmed: 1,
  documents_lodged: 2,
  dispatched: 3,
  customs_cleared: 4,
  cancelled: 98,
  held: 99
};

const LABELS = {
  booking_confirmed: 'Booking confirmed',
  documents_lodged: 'Documents lodged',
  dispatched: 'Dispatched',
  customs_cleared: 'Customs cleared',
  cancelled: 'Cancelled',
  held: 'Held'
};

// Which role may set each status, and at which end of the voyage.
//   end: 'origin' | 'destination' | null (no station requirement)
const RULES = {
  documents_lodged: { roles: ['officer'], end: 'origin' },
  dispatched: { roles: ['officer'], end: 'origin' },
  customs_cleared: { roles: ['officer'], end: 'destination' },
  held: { roles: ['officer'], end: null },
  cancelled: { roles: ['officer', 'trader'], end: null }
};

/** Terminal states: nothing may move afterwards. */
const isClosed = (status) => status === 'customs_cleared' || status === CANCELLED;

function canTransition(from, to, heldFrom) {
  if (!ALL.includes(to)) {
    return { ok: false, reason: `Unknown status "${to}". Allowed: ${ALL.join(', ')}` };
  }
  if (isClosed(from)) {
    return { ok: false, reason: `This consignment is ${LABELS[from].toLowerCase()}; the record is closed.` };
  }
  if (to === from) return { ok: false, reason: `Consignment is already ${LABELS[from].toLowerCase()}.` };

  if (to === CANCELLED) {
    // Once cargo is on the water, withdrawal is no longer a paperwork matter. The test is
    // about the CARGO, not the paperwork -- so a held consignment is judged by where it
    // was held from. A consignment held while still in the warehouse can still be
    // withdrawn; one held after the vessel sailed cannot.
    const effective = from === HELD ? heldFrom : from;
    if (effective === 'dispatched') {
      return {
        ok: false,
        reason: from === HELD
          ? 'This consignment was held after dispatch, so it can no longer be withdrawn.'
          : 'A consignment cannot be withdrawn once it has been dispatched.'
      };
    }
    return { ok: true };
  }
  if (to === HELD) return { ok: true };

  if (from === HELD) {
    const i = FLOW.indexOf(heldFrom);
    if (to === heldFrom) return { ok: true };
    if (i !== -1 && FLOW[i + 1] === to) return { ok: true };
    return {
      ok: false,
      reason: `A held consignment can only resume at ${heldFrom} or advance to ${FLOW[i + 1] || 'nothing further'}.`
    };
  }

  const a = FLOW.indexOf(from);
  const b = FLOW.indexOf(to);
  if (b < a) return { ok: false, reason: `Cannot move backwards from ${from} to ${to}.` };
  if (b > a + 1) return { ok: false, reason: `Cannot skip ahead. Next status after ${from} is ${FLOW[a + 1]}.` };
  return { ok: true };
}

/**
 * @param actor      { role: 'officer'|'trader', id, port?, traderId? }
 * @param consignment the stored record
 * @param status     the status being requested
 */
function canActorSet(actor, consignment, status) {
  // Releasing a hold. Whoever placed the hold may lift it back to exactly where it was,
  // whatever station they are at. Holds carry no station requirement, so without this the
  // power to freeze and the power to unfreeze would not match: an officer could hold a
  // consignment on a route they are not stationed on and then be unable to release it,
  // stranding the record until an officer at one of its two ports intervened.
  //
  // This is a release only -- back to heldFrom, never forward. Advancing to the next real
  // status is a customs act and keeps the full station rule below.
  if (consignment.status === HELD && status === consignment.heldFrom
      && actor.role === 'officer' && consignment.heldBy === actor.id) {
    return { ok: true };
  }

  const rule = RULES[status];
  if (!rule) return { ok: false, reason: `Status "${status}" cannot be set directly.` };

  if (!rule.roles.includes(actor.role)) {
    return { ok: false, reason: `Only ${rule.roles.join(' or ')} accounts may record "${status}".` };
  }
  if (actor.role === 'trader') {
    if (consignment.traderId !== actor.id) {
      return { ok: false, reason: 'This consignment belongs to another exporter.' };
    }
    return { ok: true };
  }
  if (rule.end) {
    const required = rule.end === 'origin' ? consignment.origin.port : consignment.destination.port;
    if (actor.port !== required) {
      return {
        ok: false,
        reason: `"${status}" must be recorded at the ${rule.end} port (${required}). You are stationed at ${actor.port}.`
      };
    }
  }
  return { ok: true };
}

/** Statuses this actor could legally set right now — drives the UI's action buttons. */
function availableActions(actor, consignment) {
  if (!actor) return [];
  return ALL.filter((s) => {
    if (!canTransition(consignment.status, s, consignment.heldFrom).ok) return false;
    return canActorSet(actor, consignment, s).ok;
  });
}

module.exports = {
  FLOW, HELD, CANCELLED, ALL, STATUS_CODES, LABELS, RULES,
  isClosed, canTransition, canActorSet, availableActions
};
