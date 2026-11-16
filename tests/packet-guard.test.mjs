import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { applyPacketGuard } from '../src/utils/packet_guard.js';

class FakeClient extends EventEmitter {
    constructor() {
        super();
        this.writes = [];
    }

    write(name, data) {
        this.writes.push({ name, data });
        return 'written';
    }
}

test('packet guard preserves non-position packets and flushes the newest movement state', async () => {
    const bot = new EventEmitter();
    bot._client = new FakeClient();
    const cleanup = applyPacketGuard(bot, { warn() {} });

    assert.equal(bot._client.write('look', { yaw: 1 }), 'written');
    bot._client.write('position', { x: 1 });
    bot._client.write('position', { x: 2 });
    await new Promise(resolve => setTimeout(resolve, 60));

    assert.deepEqual(bot._client.writes, [
        { name: 'look', data: { yaw: 1 } },
        { name: 'position', data: { x: 1 } },
        { name: 'position', data: { x: 2 } }
    ]);
    cleanup();
    assert.equal(bot._client.write('position_look', { x: 3 }), 'written');
    assert.equal(bot._client.writes.at(-1).name, 'position_look');
});

test('packet guard normalises only finite nested velocity fields', () => {
    const bot = new EventEmitter();
    bot._client = new FakeClient();
    const cleanup = applyPacketGuard(bot, { warn() {} });
    const packet = { velocity: { x: 1, y: -2, z: 3 } };
    bot._client.emit('entity_velocity', packet);
    assert.equal(packet.velocityX, 1);
    assert.equal(packet.velocityY, -2);
    assert.equal(packet.velocityZ, 3);

    const invalid = { velocity: { x: 1, y: Number.NaN, z: 3 } };
    bot._client.emit('entity_velocity', invalid);
    assert.equal(invalid.velocityX, undefined);
    cleanup();
});
