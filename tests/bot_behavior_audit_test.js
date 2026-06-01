const assert = require('assert');
const {
  auditDecision,
  aggregateAudit,
  parseArgs,
} = require('../automation/bot_behavior_audit');

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
}

function baseSnapshot(overrides = {}) {
  return {
    hp: 20,
    maxHp: 40,
    floor: 2,
    onStairs: false,
    knownStairs: true,
    exploredRatio: 0.2,
    resources: {
      potions: 0,
      buffs: 0,
      teleports: 0,
      bombs: 0,
    },
    threats: {
      live: 1,
      visible: 1,
      adjacent: 0,
      incoming: 0,
      lethalAdjacent: false,
      buffValuable: false,
    },
    ...overrides,
  };
}

test('auditDecision reports a missed strength opportunity when the bot takes a non-inventory action', () => {
  const events = auditDecision(baseSnapshot({
    resources: { potions: 0, buffs: 1, teleports: 0, bombs: 0 },
    threats: {
      live: 1,
      visible: 1,
      adjacent: 0,
      incoming: 0,
      lethalAdjacent: false,
      buffValuable: true,
    },
  }), {
    actionLabel: 'ArrowRight',
    policyLabel: 'path to enemy',
  });

  assert.strictEqual(events.missedBuff, 1);
});

test('auditDecision does not report a missed strength opportunity while opening inventory', () => {
  const events = auditDecision(baseSnapshot({
    resources: { potions: 0, buffs: 1, teleports: 0, bombs: 0 },
    threats: {
      live: 1,
      visible: 1,
      adjacent: 0,
      incoming: 0,
      lethalAdjacent: false,
      buffValuable: true,
    },
  }), {
    actionLabel: 'inventory',
    policyLabel: 'inventory',
  });

  assert.strictEqual(events.missedBuff || 0, 0);
});

test('auditDecision reports a missed lethal teleport opportunity without healing', () => {
  const events = auditDecision(baseSnapshot({
    hp: 7,
    resources: { potions: 0, buffs: 0, teleports: 1, bombs: 0 },
    threats: {
      live: 1,
      visible: 1,
      adjacent: 1,
      incoming: 9,
      lethalAdjacent: true,
      buffValuable: false,
    },
  }), {
    actionLabel: 'ability1',
    policyLabel: 'ability1',
  });

  assert.strictEqual(events.missedTeleport, 1);
});

test('auditDecision reports a missed pressure bomb opportunity', () => {
  const events = auditDecision(baseSnapshot({
    hp: 12,
    resources: { potions: 0, buffs: 0, teleports: 0, bombs: 1 },
    threats: {
      live: 1,
      visible: 1,
      adjacent: 1,
      incoming: 14,
      lethalAdjacent: true,
      bombValuable: true,
      buffValuable: false,
    },
  }), {
    actionLabel: 'ArrowUp',
    policyLabel: 'kite',
  });

  assert.strictEqual(events.missedBomb, 1);
});

test('aggregateAudit counts terminal outcomes and deaths with carried resources', () => {
  const aggregate = aggregateAudit([
    {
      status: 'dead',
      finalFloor: 2,
      beforeTerminal: {
        action: 'ability1',
        resources: { potions: 0, buffs: 1, teleports: 0, bombs: 1 },
      },
      events: { missedBuff: 2 },
    },
    {
      status: 'max_turns',
      finalFloor: 4,
      beforeTerminal: {
        action: 'path to stairs',
        resources: { potions: 2, buffs: 0, teleports: 0, bombs: 0 },
      },
      events: { overclearSteps: 1 },
    },
  ]);

  assert.strictEqual(aggregate.runs, 2);
  assert.strictEqual(aggregate.dead, 1);
  assert.strictEqual(aggregate.timeouts, 1);
  assert.strictEqual(aggregate.avgFloor, 3);
  assert.strictEqual(aggregate.events.missedBuff, 2);
  assert.strictEqual(aggregate.deathsWithResources.buffs, 1);
  assert.strictEqual(aggregate.deathsWithResources.bombs, 1);
  assert.strictEqual(aggregate.terminalActions.ability1, 1);
});

test('parseArgs supports seed lists for multi-seed audit batches', () => {
  const args = parseArgs([
    'node',
    'audit',
    '--classes',
    'warrior,mage',
    '--seeds',
    '1000,2000,3000',
    '--per-class',
    '5',
    '--max-turns',
    '1234',
    '--output',
    'audit.json',
  ]);

  assert.deepStrictEqual(args.classList, ['warrior', 'mage']);
  assert.deepStrictEqual(args.seedBases, [1000, 2000, 3000]);
  assert.strictEqual(args.perClass, 5);
  assert.strictEqual(args.maxTurns, 1234);
  assert.strictEqual(args.output, 'audit.json');
});
