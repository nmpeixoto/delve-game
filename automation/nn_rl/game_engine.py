"""
DELVE Game Engine — Pure Python port for RL training.
Faithfully reproduces the JS game logic without any IPC/subprocess overhead.
"""

import numpy as np
import math

try:
    from numba import njit
except ImportError:
    def njit(*args, **kwargs):
        def wrapper(func):
            return func
        return wrapper

@njit(cache=True)
def fast_compute_vision(px, py, map_w, map_h, map_np):
    visible_map = np.zeros(map_h * map_w, dtype=np.bool_)
    for a in range(0, 360, 3):
        rad = a * 3.141592653589793 / 180.0
        cos_a = math.cos(rad)
        sin_a = math.sin(rad)
        for r in range(6):
            ix = int(math.floor(px + cos_a * r + 0.5))
            iy = int(math.floor(py + sin_a * r + 0.5))
            if ix < 0 or ix >= map_w or iy < 0 or iy >= map_h:
                break
            k = iy * map_w + ix
            visible_map[k] = True
            tile = map_np[iy, ix]
            if tile == 0 or tile == 5 or tile == 4:
                break
    return visible_map

import random as _random_mod
from typing import Optional

# ─── CONSTANTS ───────────────────────────────────────────────────────────────
MAP_W = 56
MAP_H = 36
FLOORS = 5

TILE_WALL = 0
TILE_FLOOR = 1
TILE_STAIRS = 2
TILE_SHOP = 3
TILE_LOCKED_DOOR = 4
TILE_SECRET_DOOR = 5

# ─── SEEDED RNG ──────────────────────────────────────────────────────────────
class SeededRNG:
    """Matches the JS LCG: seed = (seed * 16807) % 2147483647."""
    __slots__ = ('_seed', 'r_count')
    def __init__(self, seed: int):
        self._seed = seed % 2147483647 or 1
        self.r_count = 0
    def random(self) -> float:
        self._seed = (self._seed * 16807) % 2147483647
        self.r_count += 1
        return (self._seed - 1) / 2147483646
    def rand(self, n: int) -> int:
        return int(self.random() * n)
    def rr(self, a: int, b: int) -> int:
        return a + self.rand(b - a + 1)
    def ch(self, p: float) -> bool:
        return self.random() < p
    def choice(self, seq):
        return seq[self.rand(len(seq))]
    def shuffle(self, seq):
        for i in range(len(seq) - 1, 0, -1):
            j = int(self.random() * (i + 1))
            seq[i], seq[j] = seq[j], seq[i]

# ─── HELPERS ─────────────────────────────────────────────────────────────────
def round1(v):
    n = float(v)
    if not math.isfinite(n):
        return 0.0
    return round(n * 10 + 1e-9) / 10  # match JS: Math.round((n + EPSILON) * 10) / 10


def js_round(v):
    return int(math.floor(float(v) + 0.5))

_id_counter = 0

# ─── DATA TABLES ─────────────────────────────────────────────────────────────
WEAPONS = [
    {'name':'Rusty Dagger','type':'weapon','atk':4,'sym':'†','rarity':'common','price':25},
    {'name':'Short Sword','type':'weapon','atk':4,'sym':'†','rarity':'common','price':50},
    {'name':'Broadsword','type':'weapon','atk':6,'sym':'⚔','rarity':'common','price':85,'reqLvl':3},
    {'name':'Steel Glaive','type':'weapon','atk':9,'sym':'⚔','rarity':'rare','price':140,'reqLvl':6},
    {'name':'Iron Mace','type':'weapon','atk':5,'sym':'⚔','rarity':'common','price':70,'reqClass':['warrior','paladin']},
    {'name':'War Hammer','type':'weapon','atk':8,'sym':'⚔','rarity':'rare','price':130,'reqClass':['warrior','paladin'],'reqLvl':5},
    {'name':'Holy Avenger','type':'weapon','atk':14,'sym':'⚔','rarity':'legendary','price':260,'reqClass':['paladin'],'reqLvl':10},
    {'name':'Champion Blade','type':'weapon','atk':15,'sym':'⚔','rarity':'legendary','price':280,'reqClass':['warrior'],'reqLvl':10},
    {'name':'Great Axe','type':'weapon','atk':4,'sym':'⚔','rarity':'common','price':70,'reqClass':['barbarian'],'critChance':0.02},
    {'name':'Savage Cleaver','type':'weapon','atk':9,'sym':'⚔','rarity':'rare','price':150,'reqClass':['barbarian'],'reqLvl':5,'critChance':0.05},
    {'name':'Titan Slayer','type':'weapon','atk':16,'sym':'⚔','rarity':'legendary','price':315,'reqClass':['barbarian'],'reqLvl':10,'critChance':0.10},
    {'name':'Twin Daggers','type':'weapon','atk':5,'sym':'†','rarity':'common','price':80,'reqClass':['rogue'],'dodgeBonus':0.02},
    {'name':'Assassin Dirk','type':'weapon','atk':8,'sym':'†','rarity':'rare','price':130,'reqClass':['rogue'],'reqLvl':5,'critChance':0.05},
    {'name':'Shadow Blade','type':'weapon','atk':14,'sym':'†','rarity':'legendary','price':260,'reqClass':['rogue'],'reqLvl':10,'vampirism':1},
    {'name':'Shortbow','type':'weapon','atk':5,'sym':'🏹','rarity':'common','price':50,'reqClass':['ranger'],'perception':1},
    {'name':'Longbow','type':'weapon','atk':7,'sym':'🏹','rarity':'rare','price':115,'reqClass':['ranger'],'reqLvl':4,'critChance':0.05},
    {'name':'Crossbow','type':'weapon','atk':10,'sym':'🏹','rarity':'rare','price':160,'reqClass':['ranger'],'reqLvl':7,'critChance':0.10},
    {'name':'Elven Bow','type':'weapon','atk':14,'sym':'🏹','rarity':'legendary','price':245,'reqClass':['ranger'],'reqLvl':10,'swiftness':1},
    {'name':'Bone Staff','type':'weapon','atk':5,'sym':'♦','rarity':'common','price':70,'reqClass':['mage','necromancer']},
    {'name':'Skull Rod','type':'weapon','atk':5,'sym':'♦','rarity':'common','price':70,'reqClass':['mage','necromancer'],'vampirism':1},
    {'name':'Arcane Wand','type':'weapon','atk':8,'sym':'♦','rarity':'rare','price':130,'reqClass':['mage','necromancer'],'reqLvl':5,'regen':1},
    {'name':'Void Staff','type':'weapon','atk':12,'sym':'♦','rarity':'rare','price':190,'reqClass':['mage','necromancer'],'reqLvl':8,'vampirism':1},
    {'name':'Elder Wand','type':'weapon','atk':18,'sym':'♦','rarity':'legendary','price':350,'reqClass':['mage'],'reqLvl':12,'regen':2},
    {'name':'Scythe of Death','type':'weapon','atk':17,'sym':'♦','rarity':'legendary','price':330,'reqClass':['necromancer'],'reqLvl':12,'vampirism':2},
]

ARMORS = [
    {'name':'Cloth Tunic','type':'armor','def':1,'sym':'◆','rarity':'common','price':15},
    {'name':'Leather Vest','type':'armor','def':2,'sym':'◆','rarity':'common','price':35},
    {'name':'Studded Armor','type':'armor','def':4,'sym':'◆','rarity':'common','price':70,'reqLvl':3},
    {'name':'Mithril Shirt','type':'armor','def':7,'sym':'◆','rarity':'rare','price':140,'reqLvl':6},
    {'name':'Chain Mail','type':'armor','def':4,'sym':'◆','rarity':'common','price':60,'reqClass':['warrior','paladin']},
    {'name':'Iron Plate','type':'armor','def':5,'sym':'◆','rarity':'common','price':80,'reqClass':['warrior','paladin']},
    {'name':'Steel Plate','type':'armor','def':8,'sym':'◆','rarity':'rare','price':140,'reqClass':['warrior','paladin'],'reqLvl':5},
    {'name':'Dragon Scale','type':'armor','def':12,'sym':'◆','rarity':'legendary','price':260,'reqClass':['warrior','paladin'],'reqLvl':10},
    {'name':'Ranger Tunic','type':'armor','def':3,'sym':'◆','rarity':'common','price':50,'reqClass':['rogue','ranger'],'perception':1},
    {'name':'Shadow Cloak','type':'armor','def':6,'sym':'◆','rarity':'rare','price':120,'reqClass':['rogue','ranger'],'reqLvl':5,'dodgeBonus':0.05},
    {'name':'Assassin Garb','type':'armor','def':10,'sym':'◆','rarity':'legendary','price':225,'reqClass':['rogue'],'reqLvl':10,'critChance':0.10,'dodgeBonus':0.05},
    {'name':'Hunter Vest','type':'armor','def':10,'sym':'◆','rarity':'legendary','price':225,'reqClass':['ranger'],'reqLvl':10,'perception':2,'dodgeBonus':0.05},
    {'name':'Furs','type':'armor','def':4,'sym':'◆','rarity':'common','price':40,'reqClass':['barbarian']},
    {'name':'Bone Armor','type':'armor','def':6,'sym':'◆','rarity':'rare','price':100,'reqClass':['barbarian'],'reqLvl':5},
    {'name':'Apprentice Robe','type':'armor','def':2,'sym':'◆','rarity':'common','price':40,'reqClass':['mage','necromancer']},
    {'name':'Mystic Robe','type':'armor','def':5,'sym':'◆','rarity':'rare','price':100,'reqClass':['mage','necromancer'],'reqLvl':5},
    {'name':'Archmage Robes','type':'armor','def':9,'sym':'◆','rarity':'legendary','price':210,'reqClass':['mage'],'reqLvl':10},
    {'name':'Lich Shroud','type':'armor','def':9,'sym':'◆','rarity':'legendary','price':210,'reqClass':['necromancer'],'reqLvl':10},
    {'name':'Gi','type':'armor','def':4,'sym':'◆','rarity':'common','price':50,'reqClass':['monk'],'dodgeBonus':0.02},
    {'name':'Master Gi','type':'armor','def':6,'sym':'◆','rarity':'rare','price':120,'reqClass':['monk'],'reqLvl':5,'dodgeBonus':0.05},
    {'name':'Grandmaster Robe','type':'armor','def':11,'sym':'◆','rarity':'legendary','price':245,'reqClass':['monk'],'reqLvl':10,'dodgeBonus':0.10,'swiftness':1},
]

POTIONS = [
    {'name':'Health Potion','type':'potion','heal':15,'sym':'!','rarity':'common','price':25},
    {'name':'Greater Potion','type':'potion','heal':30,'sym':'!','rarity':'rare','price':50},
    {'name':'Elixir of Life','type':'potion','heal':60,'sym':'!','rarity':'legendary','price':100},
    {'name':'Potion of Giant Strength','type':'potion_buff','buff':'strength','sym':'🧪','rarity':'rare','price':75},
    {'name':'Scroll of Detection','type':'scroll','sym':'📜','rarity':'common','price':200},
    {'name':'Scroll of Teleportation','type':'scroll_teleport','sym':'📜','rarity':'rare','price':150},
    {'name':'Bomb','type':'bomb','sym':'💣','rarity':'rare','price':120},
]

UPGRADES = [
    {'name':'Minor Strength Tonic','type':'upgrade','stat':'atk','amount':1,'sym':'↑','rarity':'common','price':100},
    {'name':'Strength Tonic','type':'upgrade','stat':'atk','amount':2,'sym':'↑','rarity':'rare','price':200},
    {'name':'Ogre Strength','type':'upgrade','stat':'atk','amount':3,'sym':'↑','rarity':'legendary','price':450},
    {'name':'Minor Iron Skin','type':'upgrade','stat':'def','amount':1,'sym':'↑','rarity':'common','price':100},
    {'name':'Iron Skin','type':'upgrade','stat':'def','amount':2,'sym':'↑','rarity':'rare','price':200},
    {'name':'Titan Shield','type':'upgrade','stat':'def','amount':3,'sym':'↑','rarity':'legendary','price':450},
    {'name':'Minor Vitality Brew','type':'upgrade','stat':'hp','amount':8,'sym':'♥','rarity':'common','price':90},
    {'name':'Vitality Brew','type':'upgrade','stat':'hp','amount':15,'sym':'♥','rarity':'rare','price':180},
    {'name':'Heart of the Mountain','type':'upgrade','stat':'hp','amount':30,'sym':'♥','rarity':'legendary','price':400},
    {'name':'Blessing','type':'upgrade','stat':'all','amount':1,'sym':'★','rarity':'legendary','price':450},
    {'name':'Vampiric Ring','type':'upgrade','stat':'vamp','amount':1,'sym':'💍','rarity':'legendary','price':500},
    {'name':'Vampiric Amulet','type':'upgrade','stat':'vamp','amount':2,'sym':'💍','rarity':'legendary','price':600},
    {'name':'Troll Blood','type':'upgrade','stat':'regen','amount':1,'sym':'♥','rarity':'legendary','price':500},
    {'name':'Troll Heart','type':'upgrade','stat':'regen','amount':2,'sym':'♥','rarity':'legendary','price':600},
    {'name':'Hermes Boots','type':'upgrade','stat':'swift','amount':1,'sym':'⚡','rarity':'legendary','price':450},
    {'name':"Dungeoneer's Kit",'type':'upgrade','stat':'perception','amount':1,'sym':'👁','rarity':'common','price':100},
    {'name':'Third Eye','type':'upgrade','stat':'perception','amount':2,'sym':'👁','rarity':'rare','price':250},
    {'name':"Assassin's Mark",'type':'upgrade','stat':'crit','amount':0.05,'sym':'🎯','rarity':'rare','price':250},
    {'name':'Deadly Precision','type':'upgrade','stat':'crit','amount':0.12,'sym':'🎯','rarity':'legendary','price':500},
    {'name':"Thief's Cloak",'type':'upgrade','stat':'dodge','amount':0.05,'sym':'💨','rarity':'rare','price':250},
    {'name':"Acrobat's Boots",'type':'upgrade','stat':'dodge','amount':0.12,'sym':'💨','rarity':'legendary','price':500},
    {'name':'Midas Coin','type':'upgrade','stat':'goldBonus','amount':5,'sym':'💰','rarity':'rare','price':200},
    {'name':"Scholar's Quill",'type':'upgrade','stat':'xpMult','amount':0.20,'sym':'📖','rarity':'rare','price':300},
]

LEGENDARIES = [
    {'name':'Ring of the Fallen','type':'upgrade','stat':'all5','amount':5,'sym':'💍','rarity':'legendary','price':1000},
    {'name':'Cloak of Shadows','type':'armor','def':15,'sym':'◆','rarity':'legendary','price':1000,'dodgeBonus':0.25},
    {'name':'Necronomicon','type':'upgrade','stat':'magicMult','amount':1.5,'sym':'📖','rarity':'legendary','price':1000},
]

ENEMIES_DATA = [
    {'name':'Rat','sym':'r','hp':8,'atk':3,'def':0,'xp':3,'gold':2},
    {'name':'Goblin','sym':'g','hp':15,'atk':6,'def':1,'xp':6,'gold':4,'dodge':0.2},
    {'name':'Skeleton','sym':'s','hp':25,'atk':9,'def':2,'xp':10,'gold':6,'revive':True},
    {'name':'Orc','sym':'o','hp':40,'atk':12,'def':3,'xp':15,'gold':10,'enrage':True},
    {'name':'Troll','sym':'T','hp':60,'atk':18,'def':4,'xp':25,'gold':15,'regen':0.1},
    {'name':'Demon','sym':'D','hp':85,'atk':22,'def':5,'xp':35,'gold':22,'vampiric':0.5},
    {'name':'Lich','sym':'L','hp':120,'atk':26,'def':6,'xp':50,'gold':30,'freezeChance':0.25},
    {'name':'Dungeon Lord','sym':'M','hp':260,'atk':24,'def':6,'xp':250,'gold':150,
     'boss':True,'phase':1,'phaseAtkMult':1.3,'phaseDefMult':1.25,'phaseSummons':1},
]

CLASS_DATA = {
    'warrior': {'hp':32,'atk':4,'def':3,'weapon':'Short Sword','armor':'Chain Mail','critChance':0.05},
    'rogue':   {'hp':24,'atk':7,'def':2,'weapon':'Rusty Dagger','armor':'Leather Vest','dodgeBonus':0.4},
    'mage':    {'hp':20,'atk':4,'def':2,'weapon':'Bone Staff','armor':'Apprentice Robe','critChance':0.1},
    'paladin': {'hp':26,'atk':4,'def':1,'weapon':'Iron Mace','armor':'Iron Plate','critChance':0.05},
    'ranger':  {'hp':20,'atk':2,'def':1,'weapon':'Shortbow','armor':'Ranger Tunic','perception':1,'critChance':0.1},
    'barbarian':{'hp':42,'atk':5,'def':2,'weapon':'Great Axe','armor':'Furs','critChance':0.15},
    'necromancer':{'hp':18,'atk':4,'def':1,'weapon':'Skull Rod','armor':'Apprentice Robe','critChance':0.05},
    'monk':    {'hp':28,'atk':4,'def':2,'weapon':None,'armor':'Gi','critChance':0.05},
}

FLOOR_ENEMY_PROFILES = [
    {'tierMin':0,'tierMax':1,'scale':0.9},
    {'tierMin':1,'tierMax':2,'scale':1.2},
    {'tierMin':2,'tierMax':3,'scale':1.45},
    {'tierMin':3,'tierMax':4,'scale':1.7},
    {'tierMin':4,'tierMax':6,'scale':2.05},
]


class DelveGame:
    """
    Pure-Python DELVE game engine.  Faithfully reproduces the JS game for RL training.
    """

    def __init__(self, seed: int = 1, player_class: str = 'warrior', hard_mode: bool = False):
        self.rng = SeededRNG(seed)
        self.player_class = player_class
        self.hard_mode = hard_mode

        # Game state (matches G in JS)
        self.floor = 1
        self.turn = 0
        self.game_over = False
        self.won = False
        self.map = None
        self.rooms = []
        self.enemies = []
        self.items = []
        self.traps = []
        self.rooms = []
        self.shops = []
        self._door_count = 0
        self._secret_count = 0
        self._walkable_total = 0
        self._death_batch = []

        self.visible = set()
        self.seen = set()
        self.ability1_cooldown = 0
        self.ability2_cooldown = 0
        self.alarmed_turns = 0
        self.pending_hit = None  # pending emergency potion prompt for RL policy
        self.player = {}
        self._stair_coords = []
        self._door_count = 0
        self._secret_count = 0
        self._walkable_total = 0

        self._init_player()
        self._build_floor()

    def _uid(self):
        global _id_counter
        _id_counter += 1
        return f"py-{_id_counter}"

    # ─── PLAYER INIT ──────────────────────────────────────────────────────
    def _init_player(self):
        cd = CLASS_DATA.get(self.player_class, CLASS_DATA['warrior'])
        p = {
            'x': 0, 'y': 0, 'lvl': 1, 'xp': 0, 'xpNext': 10,
            'weapon': None, 'armor': None, 'kills': 0, 'gold': 0,
            'damageDealt': 0, 'bestWeapon': 'Bare hands',
            'class': self.player_class,
            'shieldWallTurns': 0, 'vanishTurns': 0, 'freeMoves': 0,
            'bloodlustTurns': 0, 'rootedTurns': 0, 'poisonedTurns': 0,
            'strengthTurns': 0,
            'vampirism': cd.get('vampirism', 0),
            'regen': cd.get('regen', 0),
            'swiftness': cd.get('swiftness', 0),
            'tilesExplored': 0,
            'critChance': cd.get('critChance', 0),
            'dodgeBonus': cd.get('dodgeBonus', 0),
            'goldBonus': cd.get('goldBonus', 0),
            'xpMult': cd.get('xpMult', 0),
            'perception': cd.get('perception', 0),
            'magicMult': 1.0,
        }
        p['hp'] = cd.get('hp', 20)
        p['maxHp'] = cd.get('hp', 20)
        p['atk'] = cd.get('atk', 1)
        p['def'] = cd.get('def', 0)

        # Starting weapon
        wname = cd.get('weapon')
        if wname:
            wdata = next((w for w in WEAPONS if w['name'] == wname), None)
            if wdata:
                w = dict(wdata)
                w['id'] = self._uid()
                p['weapon'] = w
                p['bestWeapon'] = f"{w['name']} (ATK+{w['atk']})"

        # Starting armor
        aname = cd.get('armor')
        if aname:
            adata = next((a for a in ARMORS if a['name'] == aname), None)
            if adata:
                a = dict(adata)
                a['id'] = self._uid()
                p['armor'] = a

        self.player = p

        # Starter potion on normal mode
        if not self.hard_mode:
            pot = next((pt for pt in POTIONS if pt['name'] == 'Health Potion'), None)
            if pot:
                self.items.append({**pot, 'id': f"starter-potion-{self.player_class}", 'carried': True, 'x': None, 'y': None})

    # ─── STAT HELPERS ─────────────────────────────────────────────────────
    def _get_stat(self, stat_name):
        base = self.player.get(stat_name, 0)
        w = self.player['weapon'].get(stat_name, 0) if self.player.get('weapon') else 0
        a = self.player['armor'].get(stat_name, 0) if self.player.get('armor') else 0
        return base + w + a

    def _gatk(self):
        p = self.player
        w = p.get('weapon')
        if w is None:
            total = p['atk'] + (math.ceil(p['lvl'] / 2) if p['class'] == 'monk' else 0)
        else:
            power = w.get('atk', 0)
            if p['class'] == 'mage' and w.get('sym') == '♦':
                power += power // 5
            total = p['atk'] + power
        if p['class'] == 'barbarian':
            total += (p['maxHp'] - p['hp']) // 6
        if p.get('strengthTurns', 0) > 0:
            total += 10
        return total

    def _gdef(self):
        p = self.player
        return p['def'] + (p['armor']['def'] if p.get('armor') else 0)

    def _player_dodge_chance(self):
        dodge = self._get_stat('dodgeBonus')
        if self.player['class'] == 'rogue' and 'dodgeBonus' not in self.player:
            dodge += 0.4  # This shouldn't happen since we set it in init, but safety
        return dodge

    def _weapon_damage(self, w):
        if w is None:
            return math.ceil(self.player['lvl'] / 2) if self.player['class'] == 'monk' else 0
        power = w.get('atk', 0)
        if self.player['class'] == 'mage' and w.get('sym') == '♦':
            power += power // 5
        return power

    def _weapon_power(self, w):
        power = self._weapon_damage(w)
        if w is None:
            return power
        sec = 0
        if w.get('vampirism'): sec += w['vampirism'] * 0.1
        if w.get('critChance'): sec += w['critChance']
        if w.get('perception'): sec += w['perception'] * 0.1
        if w.get('swiftness'): sec += w['swiftness'] * 0.5
        if w.get('dodgeBonus'): sec += w['dodgeBonus']
        if w.get('regen'): sec += w['regen'] * 0.1
        return power + sec

    def _armor_power(self, a):
        if a is None:
            return 0
        power = a.get('def', 0)
        sec = 0
        if a.get('dodgeBonus'): sec += a['dodgeBonus']
        if a.get('perception'): sec += a['perception'] * 0.1
        if a.get('swiftness'): sec += a['swiftness'] * 0.5
        if a.get('critChance'): sec += a['critChance']
        return power + sec

    def _can_equip(self, it):
        if it.get('reqLvl') and self.player['lvl'] < it['reqLvl']:
            return False
        if it.get('reqClass') and self.player['class'] not in it['reqClass']:
            return False
        return True

    def _is_class_usable_gear(self, item):
        if item.get('type') not in ('weapon', 'armor'):
            return False
        if item.get('reqClass') and self.player['class'] not in item['reqClass']:
            return False
        return True

    # ─── MAP GENERATION ───────────────────────────────────────────────────
    def _generate_map(self):
        rng = self.rng
        m = [[TILE_WALL] * MAP_W for _ in range(MAP_H)]
        rooms = []

        def carve(x, y, w, h):
            for ry in range(y, y + h):
                for rx in range(x, x + w):
                    if 0 < ry < MAP_H - 1 and 0 < rx < MAP_W - 1:
                        m[ry][rx] = TILE_FLOOR
            rooms.append({'x': x, 'y': y, 'w': w, 'h': h,
                          'cx': x + w // 2, 'cy': y + h // 2, 'type': 'normal'})

        def tunnel(x1, y1, x2, y2):
            cx, cy = x1, y1
            while cx != x2:
                m[cy][cx] = TILE_FLOOR
                cx += 1 if x2 > cx else -1
            while cy != y2:
                m[cy][cx] = TILE_FLOOR
                cy += 1 if y2 > cy else -1

        def direct_tunnel(x1, y1, x2, y2):
            cx, cy = x1, y1
            dx, dy = x2 - x1, y2 - y1
            if abs(dx) > abs(dy):
                while cx != x2:
                    m[cy][cx] = TILE_FLOOR
                    cx += 1 if x2 > cx else -1
                while cy != y2:
                    m[cy][cx] = TILE_FLOOR
                    cy += 1 if y2 > cy else -1
            else:
                while cy != y2:
                    m[cy][cx] = TILE_FLOOR
                    cy += 1 if y2 > cy else -1
                while cx != x2:
                    m[cy][cx] = TILE_FLOOR
                    cx += 1 if x2 > cx else -1

        n = rng.rr(14, 22)
        att = 0
        while len(rooms) < n and att < 300:
            att += 1
            rw, rh = rng.rr(3, 7), rng.rr(3, 5)
            rx, ry = rng.rr(1, MAP_W - rw - 1), rng.rr(1, MAP_H - rh - 1)
            ok = True
            for r in rooms:
                if rx < r['x'] + r['w'] + 1 and rx + rw > r['x'] - 1 and \
                   ry < r['y'] + r['h'] + 1 and ry + rh > r['y'] - 1:
                    ok = False
                    break
            if ok:
                carve(rx, ry, rw, rh)

        for i in range(1, len(rooms)):
            tunnel(rooms[i - 1]['cx'], rooms[i - 1]['cy'], rooms[i]['cx'], rooms[i]['cy'])

        # Assign special room types
        pool = rooms[1:-1] if len(rooms) > 2 else []
        rng.shuffle(pool)
        if len(pool) > 0: pool[0]['type'] = 'armory'
        if len(pool) > 1: pool[1]['type'] = 'crypt'
        if len(pool) > 2: pool[2]['type'] = 'shrine'

        # Hidden rooms
        def can_place_hidden(sx, sy, sw, sh):
            if sx < 2 or sy < 2 or sx + sw >= MAP_W - 2 or sy + sh >= MAP_H - 2:
                return False
            for y in range(sy - 1, sy + sh + 1):
                for x in range(sx - 1, sx + sw + 1):
                    if m[y][x] != TILE_WALL:
                        return False
            return True

        def find_hidden_connection(sx, sy, sw, sh):
            for r in range(2, 7):
                for y in range(sy - r, sy + sh + r):
                    for x in range(sx - r, sx + sw + r):
                        if 0 < y < MAP_H - 1 and 0 < x < MAP_W - 1 and m[y][x] == TILE_FLOOR:
                            return (x, y)
            return None

        def carve_hidden_room(htype, sx, sy, sw, sh, conn):
            direct_tunnel(sx + sw // 2, sy + sh // 2, conn[0], conn[1])
            for ry in range(sy, sy + sh):
                for rx in range(sx, sx + sw):
                    m[ry][rx] = TILE_FLOOR
            door_tile = TILE_LOCKED_DOOR if htype == 'treasure' else TILE_SECRET_DOOR
            potential_doors = []
            for y in range(sy - 1, sy + sh + 1):
                for x in range(sx - 1, sx + sw + 1):
                    if (x == sx - 1 or x == sx + sw or y == sy - 1 or y == sy + sh) and m[y][x] == TILE_FLOOR:
                        potential_doors.append((x, y))
            if not potential_doors:
                return False
            door_idx = rng.rand(len(potential_doors))
            for i, (px, py) in enumerate(potential_doors):
                m[py][px] = door_tile if i == door_idx else TILE_WALL
            rooms.insert(len(rooms) - 1, {'x': sx, 'y': sy, 'w': sw, 'h': sh,
                                           'cx': sx + sw // 2, 'cy': sy + sh // 2, 'type': htype})
            return True

        def add_hidden_room(htype):
            for _ in range(120):
                sw, sh = rng.rr(3, 4), rng.rr(3, 4)
                sx, sy = rng.rr(2, MAP_W - sw - 2), rng.rr(2, MAP_H - sh - 2)
                if can_place_hidden(sx, sy, sw, sh):
                    conn = find_hidden_connection(sx, sy, sw, sh)
                    if conn:
                        if carve_hidden_room(htype, sx, sy, sw, sh, conn):
                            return True
            # Exhaustive search
            for sh in range(3, 5):
                for sw in range(3, 5):
                    for sy in range(2, MAP_H - sh - 2):
                        for sx in range(2, MAP_W - sw - 2):
                            if can_place_hidden(sx, sy, sw, sh):
                                conn = find_hidden_connection(sx, sy, sw, sh)
                                if conn:
                                    if carve_hidden_room(htype, sx, sy, sw, sh, conn):
                                        return True
            return False

        add_hidden_room('treasure')
        add_hidden_room('secret')
        add_hidden_room('secret')

        return m, rooms

    # ─── BUILD FLOOR ──────────────────────────────────────────────────────
    def _build_floor(self):
        rng = self.rng
        self.map, rooms = self._generate_map()
        self.rooms = rooms
        self.enemies = []
        self.shops = []
        self.traps = []
        self.current_shop = None
        self.current_shrine = None
        self.visible = set()
        self.seen = set()
        self._stair_coords = []
        self._door_count = 0
        self._secret_count = 0
        self._walkable_total = 0
        self.items = [i for i in self.items if i.get('carried')]

        # Boss floor
        if self.floor == FLOORS:
            m = [[TILE_WALL] * MAP_W for _ in range(MAP_H)]
            bw = max(10, MAP_W * 6 // 10)
            bh = max(10, MAP_H * 6 // 10)
            bx = (MAP_W - bw) // 2
            by = (MAP_H - bh) // 2
            rooms = [{'x': bx, 'y': by, 'w': bw, 'h': bh,
                      'cx': bx + bw // 2, 'cy': by + bh // 2, 'type': 'normal'}]
            for y in range(by, by + bh):
                for x in range(bx, bx + bw):
                    m[y][x] = TILE_FLOOR
            self.map = m
            self.rooms = rooms
            self.player['x'] = rooms[0]['cx']
            self.player['y'] = by + bh - 2

            bt = ENEMIES_DATA[-1]  # Dungeon Lord
            hm = 1.2 if self.hard_mode else 1.0
            boss = {**bt,
                    'hp': round(bt['hp'] * hm), 'maxHp': round(bt['hp'] * hm),
                    'atk': round(bt['atk'] * hm), 'def': round(bt['def'] * hm),
                    'x': rooms[0]['cx'], 'y': by + 2, 'id': self._uid(), 'stunnedTurns': 0,
                    'dying': False, 'isPet': False, 'isElite': False}
            self.enemies.append(boss)
            self._recount_map_metadata()
            self._compute_vision()
            return

        self.player['x'] = rooms[0]['cx']
        self.player['y'] = rooms[0]['cy']

        # Stairs
        stairs_candidates = [r for r in rooms[1:] if r['type'] == 'normal']
        target = 3 if (not self.hard_mode and self.floor >= 4) else 5
        offset = max(0, min(target, len(stairs_candidates) - 1))
        stairs_room = stairs_candidates[offset] if stairs_candidates else rooms[min(6, len(rooms) - 1)]

        # Shops
        if len(rooms) >= 5:
            shop_pool = [r for r in rooms[1:-1] if r is not stairs_room and r['type'] == 'normal']
            rng.shuffle(shop_pool)
            num_shops = min(1 if self.hard_mode else 3, len(shop_pool))
            for i in range(num_shops):
                sr = shop_pool[i]
                sr['type'] = 'shop'
                self.shops.append({'x': sr['cx'], 'y': sr['cy'], 'stock': self._generate_shop_stock()})
                self.map[sr['cy']][sr['cx']] = TILE_SHOP

        self.map[stairs_room['cy']][stairs_room['cx']] = TILE_STAIRS
        self._stair_coords = [(stairs_room['cx'], stairs_room['cy'])]

        self._compute_vision()
        start_visible = set(self.visible)

        # Populate rooms
        for i in range(1, len(rooms)):
            r = rooms[i]
            if r.get('type') == 'shop':
                continue

            ne = 0
            base_enemies = rng.rr(1, 1 + min(self.floor, 4))
            guaranteed_items = 0
            item_filter = None
            is_elite = False
            is_crypt = False

            if r['type'] == 'treasure':
                ne = 1; is_elite = True; guaranteed_items = 2 + rng.rr(0, 1)
            elif r['type'] == 'armory':
                ne = rng.rr(3, 4); guaranteed_items = 1 + rng.rr(0, 1)
                item_filter = lambda it: it.get('type') in ('weapon', 'armor')
            elif r['type'] == 'crypt':
                ne = base_enemies * 3; is_crypt = True; guaranteed_items = 1
            elif r['type'] == 'shrine':
                ne = rng.rr(1, 2)
                shrine_types = ['Blood', 'Greed', 'Cursed']
                s_type = rng.choice(shrine_types)
                self.items.append({'id': self._uid(), 'x': r['cx'], 'y': r['cy'],
                                   'name': s_type + ' Shrine', 'type': 'shrine',
                                   'shrineType': s_type, 'rarity': 'legendary', 'sym': '⛊',
                                   'carried': False})
            elif r['type'] == 'secret':
                ne = 0; guaranteed_items = 1 + rng.rr(0, 1)
            else:
                ne = base_enemies
                if rng.ch(0.65):
                    guaranteed_items = 1

            profile = FLOOR_ENEMY_PROFILES[max(0, min(self.floor - 1, len(FLOOR_ENEMY_PROFILES) - 1))]
            for _ in range(ne):
                tier = rng.rr(profile['tierMin'], profile['tierMax'])
                t = ENEMIES_DATA[tier]
                sc = profile['scale']
                if is_crypt: sc *= 1.2
                if self.hard_mode: sc *= 1.2

                ex, ey = 0, 0
                for _ in range(30):
                    ex = r['x'] + rng.rr(0, r['w'] - 1)
                    ey = r['y'] + rng.rr(0, r['h'] - 1)
                    dist = abs(ex - self.player['x']) + abs(ey - self.player['y'])
                    is_vis = (ey * MAP_W + ex) in start_visible
                    if not is_vis and dist > 8 and self.map[ey][ex] != TILE_STAIRS:
                        break
                
                dist = abs(ex - self.player['x']) + abs(ey - self.player['y'])
                is_vis = (ey * MAP_W + ex) in start_visible
                if is_vis and dist <= 8:
                    continue

                gold_mult = 0.7 if self.hard_mode else 1
                xp_scale = 1.0
                if not self.hard_mode:
                    if self.floor == 3: xp_scale = 1.35
                    elif self.floor == 4: xp_scale = 1.6
                pressure = 0.9 if (not self.hard_mode and self.floor == 4) else 1.0

                enemy = {
                    'name': t['name'], 'sym': t.get('sym', '?'),
                    'hp': round(t['hp'] * sc * pressure),
                    'maxHp': round(t['hp'] * sc * pressure),
                    'atk': round(t['atk'] * sc * pressure),
                    'def': round(t['def'] * sc * pressure),
                    'xp': round(t['xp'] * (1.5 if is_crypt else 1) * sc * xp_scale),
                    'gold': round(t['gold'] * sc * gold_mult),
                    'x': ex, 'y': ey, 'id': self._uid(), 'stunnedTurns': 0,
                    'dying': False, 'isPet': False, 'isElite': False,
                    'revive': t.get('revive', False),
                    'reviveTurns': 0,
                    'enrage': t.get('enrage', False),
                    'regen': t.get('regen', 0),
                    'vampiric': t.get('vampiric', 0),
                    'freezeChance': t.get('freezeChance', 0),
                    'dodge': t.get('dodge', 0),
                    'boss': t.get('boss', False),
                    'phase': t.get('phase', 0),
                    'phaseAtkMult': t.get('phaseAtkMult', 1.0),
                    'phaseDefMult': t.get('phaseDefMult', 1.0),
                    'phaseSummons': t.get('phaseSummons', 0),
                    'raiseCorpseTarget': False,
                    'raiseCorpseTurns': 0,
                    'lifespanTurns': None,
                    'petSummonedTurn': None,
                }
                if is_elite:
                    enemy['hp'] *= 2
                    enemy['maxHp'] *= 2
                    enemy['atk'] *= 2
                    enemy['isElite'] = True
                    enemy['name'] = "Elite " + enemy['name']
                self.enemies.append(enemy)

            for g in range(guaranteed_items):
                prefer_class = (r.get('type') == 'armory' and g == 0)
                force_high = (r.get('type') in ('treasure', 'crypt', 'secret'))
                self._spawn_item(r, item_filter, force_high, prefer_class)

        # Traps
        num_traps = rng.rr(3, 7 + self.floor)
        for _ in range(num_traps):
            if len(rooms) <= 1:
                break
            tr = rooms[rng.rr(1, len(rooms) - 1)]
            if tr['type'] in ('shop', 'treasure'):
                continue
            tx, ty = 0, 0
            for att in range(20):
                tx = tr['x'] + rng.rr(0, tr['w'] - 1)
                ty = tr['y'] + rng.rr(0, tr['h'] - 1)
                if not (tr['type'] == 'shrine' and tx == tr['cx'] and ty == tr['cy']) and \
                   not (self.map[ty][tx] == TILE_STAIRS):
                    break
            ttype = 'spike' if rng.ch(0.5) else ('gas' if rng.ch(0.5) else 'alarm')
            self.traps.append({'x': tx, 'y': ty, 'type': ttype, 'triggered': False, 'revealed': False})

        # Keys
        key_rooms = [r for r in rooms[1:] if r['type'] == 'normal']
        rng.shuffle(key_rooms)
        key_count = min(len(key_rooms), rng.rr(1, 2))
        for i in range(key_count):
            kr = key_rooms[i]
            kx, ky = 0, 0
            for att in range(20):
                kx = kr['x'] + rng.rr(0, kr['w'] - 1)
                ky = kr['y'] + rng.rr(0, kr['h'] - 1)
                if self.map[ky][kx] != TILE_STAIRS:
                    break
            self.items.append({'id': self._uid(), 'x': kx, 'y': ky, 'name': 'Key',
                               'type': 'key', 'rarity': 'common', 'sym': '⚷', 'carried': False})

        self._recount_map_metadata()
        self._compute_vision()

    def _recount_map_metadata(self):
        self._door_count = sum(1 for row in self.map for t in row if t == TILE_LOCKED_DOOR)
        self._secret_count = sum(1 for row in self.map for t in row if t == TILE_SECRET_DOOR)
        self._walkable_total = sum(
            1
            for row in self.map
            for t in row
            if t in (TILE_FLOOR, TILE_STAIRS, TILE_SHOP, TILE_LOCKED_DOOR)
        )

    def _reveal_secret_tile(self, x, y):
        if self.map[y][x] != TILE_SECRET_DOOR:
            return False
        self.map[y][x] = TILE_FLOOR
        self._secret_count = max(0, self._secret_count - 1)
        self._walkable_total += 1
        return True

    # ─── ITEM SPAWNING ────────────────────────────────────────────────────
    def _spawn_item(self, r, item_filter=None, force_high=False, prefer_class=False):
        rng = self.rng
        has_bounds = r.get('w') is not None and r.get('h') is not None
        cx, cy = r['x'], r['y']
        for _ in range(20):
            cx = r['x'] + rng.rr(0, r['w'] - 1) if has_bounds else r['x']
            cy = r['y'] + rng.rr(0, r['h'] - 1) if has_bounds else r['y']
            if self.map and self.map[cy][cx] != TILE_STAIRS:
                break

        weapon_pool = [w for w in WEAPONS if self._is_class_usable_gear(w) and
                       (not w.get('reqLvl') or self.player['lvl'] >= w['reqLvl'] - 2)]
        armor_pool = [a for a in ARMORS if self._is_class_usable_gear(a) and
                      (not a.get('reqLvl') or self.player['lvl'] >= a['reqLvl'] - 2)]

        pool = []
        if rng.ch(0.3) or force_high:
            pool.extend(weapon_pool)
        if rng.ch(0.3) or force_high:
            pool.extend(armor_pool)
        if not force_high:
            pool.extend(POTIONS)
            # Weight healing potions higher to ensure adequate supply
            pool.extend([p for p in POTIONS if p.get('type') == 'potion'])

        if item_filter:
            pool = [p for p in pool if item_filter(p)]

        if prefer_class:
            class_gear = [w for w in WEAPONS + ARMORS if
                          w.get('reqClass') and self.player['class'] in w['reqClass'] and
                          self._is_class_usable_gear(w) and
                          (not w.get('reqLvl') or self.player['lvl'] >= w['reqLvl'] - 2)]
            if item_filter:
                class_gear = [g for g in class_gear if item_filter(g)]
            if class_gear:
                pool = class_gear

        if not pool:
            pool = list(POTIONS)

        item = rng.choice(pool)
        if force_high:
            rares = [x for x in pool if x.get('rarity') in ('rare', 'legendary')]
            if rares:
                item = rng.choice(rares)

        self.items.append({**item, 'x': cx, 'y': cy, 'id': self._uid(), 'carried': False})

    # ─── SHOP ─────────────────────────────────────────────────────────────
    def _generate_shop_stock(self):
        rng = self.rng
        stock = []
        used_names = set()

        def add_stock(item):
            if not item or item['name'] in used_names:
                return
            used_names.add(item['name'])
            stock.append({**item, 'id': self._uid(), 'sold': False})

        def near_level(item):
            return not item.get('reqLvl') or self.player['lvl'] >= item['reqLvl'] - 2

        pots = list(POTIONS)
        rng.shuffle(pots)
        for i in range(min(len(pots), rng.rr(3, 5))):
            add_stock(pots[i])

        weapon_cands = [w for w in WEAPONS if w['atk'] <= 4 + self.floor * 3 and near_level(w)]
        armor_cands = [a for a in ARMORS if a['def'] <= 2 + self.floor * 2 and near_level(a)]
        class_gear = [i for i in weapon_cands + armor_cands if near_level(i) and self._is_class_usable_gear(i)]
        class_specific = [i for i in class_gear if i.get('reqClass') and self.player['class'] in i['reqClass']]
        priority = class_specific if class_specific else class_gear
        if priority:
            add_stock(priority[rng.rr(0, len(priority) - 1)])

        weps = [w for w in weapon_cands if w['name'] not in used_names]
        rng.shuffle(weps)
        for i in range(min(len(weps), rng.rr(4, 6))):
            add_stock(weps[i])

        arms = [a for a in armor_cands if a['name'] not in used_names]
        rng.shuffle(arms)
        for i in range(min(len(arms), rng.rr(3, 4))):
            add_stock(arms[i])

        if self.floor >= 2:
            ups = [u for u in UPGRADES if u['rarity'] != 'legendary' or self.floor >= 4]
            rng.shuffle(ups)
            for i in range(min(len(ups), 2)):
                add_stock(ups[i])

        return stock

    def _apply_upgrade(self, item):
        p = self.player
        amount = item.get('amount', 0)
        stat = item.get('stat', '')
        if stat == 'atk': p['atk'] = round1(p['atk'] + amount)
        elif stat == 'def': p['def'] = round1(p['def'] + amount)
        elif stat == 'hp':
            p['maxHp'] = round1(p['maxHp'] + amount)
            p['hp'] = round1(min(p['maxHp'], p['hp'] + amount))
        elif stat == 'all':
            p['atk'] = round1(p['atk'] + 1)
            p['def'] = round1(p['def'] + 1)
            p['maxHp'] = round1(p['maxHp'] + 10)
            p['hp'] = round1(min(p['maxHp'], p['hp'] + 10))
        elif stat == 'all5':
            p['atk'] = round1(p['atk'] + 5)
            p['def'] = round1(p['def'] + 5)
            p['maxHp'] = round1(p['maxHp'] + 50)
            p['hp'] = round1(min(p['maxHp'], p['hp'] + 50))
        elif stat == 'magicMult': p['magicMult'] = round1(p.get('magicMult', 1) * amount)
        elif stat == 'vamp': p['vampirism'] = round1(p.get('vampirism', 0) + amount)
        elif stat == 'regen': p['regen'] = round1(p.get('regen', 0) + amount)
        elif stat == 'swift': p['swiftness'] = round1(p.get('swiftness', 0) + amount)
        elif stat == 'perception': p['perception'] = round1(p.get('perception', 0) + amount)
        elif stat == 'crit': p['critChance'] = round1(p.get('critChance', 0) + amount)
        elif stat == 'dodge': p['dodgeBonus'] = round1(p.get('dodgeBonus', 0) + amount)
        elif stat == 'goldBonus': p['goldBonus'] = round1(p.get('goldBonus', 0) + amount)
        elif stat == 'xpMult': p['xpMult'] = round1(p.get('xpMult', 0) + amount)

    # ─── VISION ───────────────────────────────────────────────────────────
    def _compute_vision(self):
        self.map_np = np.array(self.map, dtype=np.int32)
            
        vis_mask = fast_compute_vision(self.player['x'], self.player['y'], MAP_W, MAP_H, self.map_np)
        keys = set(np.nonzero(vis_mask)[0].tolist())
        
        self.visible = keys
        new_keys = keys - self.seen
        new_tiles = len(new_keys)
        self.seen.update(new_keys)

        if new_tiles > 0:
            for _ in range(new_tiles):
                self.player['tilesExplored'] += 1
                te = self.player['tilesExplored']

                regen = self._get_stat('regen')
                if regen > 0 and te % 10 == 0:
                    self.player['hp'] = round1(min(self.player['maxHp'], self.player['hp'] + regen))

                if self.player['class'] == 'warrior' and te % 12 == 0 and self.player['hp'] < self.player['maxHp']:
                    self.player['hp'] = round1(min(self.player['maxHp'], self.player['hp'] + 1))

                swift = self._get_stat('swiftness')
                if swift > 0 and te % 15 == 0:
                    self.player['freeMoves'] += swift

        # Perception
        perc = self._get_stat('perception')
        if perc > 0:
            px, py = self.player['x'], self.player['y']
            perc_int = int(perc)
            for y in range(max(0, py - perc_int), min(MAP_H, py + perc_int + 1)):
                for x in range(max(0, px - perc_int), min(MAP_W, px + perc_int + 1)):
                    if y * MAP_W + x not in self.visible:
                        continue
                    if self.map[y][x] == TILE_SECRET_DOOR:
                        self._reveal_secret_tile(x, y)

                    for trap in self.traps:
                        if trap['x'] == x and trap['y'] == y and not trap.get('revealed'):
                            trap['revealed'] = True

    # ─── COMBAT ───────────────────────────────────────────────────────────
    def _attack_enemy(self, en_id, multiplier=1, skip_counter=False):
        en = next((e for e in self.enemies if e['id'] == en_id), None)
        if not en or en['dying']:
            return

        is_sneak = False
        is_crit = False
        if self.player.get('vanishTurns', 0) > 0:
            multiplier *= 2
            self.player['vanishTurns'] = 0
            is_sneak = True
        if self._get_stat('critChance') > 0 and self.rng.random() < self._get_stat('critChance'):
            multiplier *= 2
            is_crit = True

        if en.get('dodge') and self.rng.random() < en['dodge']:
            pass  # dodged
        else:
            dmg = round1(max(1, self._gatk() - en['def'] + self.rng.rand(3)))
            if multiplier > 1:
                dmg = round1(dmg * multiplier)
            en['hp'] = round1(en['hp'] - dmg)
            self.player['damageDealt'] = round1(self.player.get('damageDealt', 0) + dmg)

            if self.player.get('bloodlustTurns', 0) > 0:
                heal = dmg // 2
                if heal > 0:
                    self.player['hp'] = round1(min(self.player['maxHp'], self.player['hp'] + heal))

            if en.get('enrage') and en['hp'] <= en['maxHp'] / 2:
                pass  # visual only

        if en['hp'] <= 0:
            if en.get('reviveTurns', 0) > 0:
                self._kill_enemy(en, False)
                return
            elif en.get('revive'):
                en['revive'] = False
                en['reviveTurns'] = 2
                en['hp'] = 0
                en['name'] = 'Bones'
            else:
                self._kill_enemy(en, False)
                return

        if skip_counter:
            self._advance_turn()
            return

        if en.get('stunnedTurns', 0) > 0:
            self._advance_turn()
            return

        # Counter attack
        edm = round1(max(1, en['atk'] - self._gdef() + self.rng.rand(3)))
        if en.get('enrage') and en['hp'] <= en['maxHp'] / 2:
            edm = edm * 3 // 2
        if self.player.get('shieldWallTurns', 0) > 0:
            edm = math.ceil(edm * 3 / 5)
        if self.player.get('bloodlustTurns', 0) > 0:
            edm = math.ceil(edm * 23 / 20)
        edm = round1(edm)

        dodge_chance = self._player_dodge_chance()
        if dodge_chance > 0 and self.rng.ch(dodge_chance):
            self._advance_turn()
        else:
            def apply_hit():
                self.player['hp'] = round1(max(0, self.player['hp'] - edm))

                if en.get('vampiric') and edm > 0:
                    heal = int(edm * en['vampiric'])
                    if heal > 0:
                        en['hp'] = round1(min(en['maxHp'], en['hp'] + heal))
                if en.get('freezeChance') and self.rng.random() < en['freezeChance']:
                    self.player['rootedTurns'] = 2

                self._advance_turn()
                if self.player['hp'] <= 0:
                    self.game_over = True

            if not self._offer_emergency_potion(en, edm, apply_hit):
                apply_hit()

    def _incoming_damage_max(self, enemy, dmg):
        max_next = round1(max(dmg, max(1, enemy['atk'] - self._gdef() + 2)))
        if self.player.get('shieldWallTurns', 0) > 0:
            max_next = math.ceil(max_next * 3 / 5)
        if self.player.get('bloodlustTurns', 0) > 0:
            max_next = math.ceil(max_next * 23 / 20)
        return round1(max_next)

    def _emergency_potion_chain(self, max_next):
        """Return potion ids the browser prompt would offer for this hit."""
        potions = [i for i in self.items if i.get('carried') and i.get('type') == 'potion']
        if not potions:
            return []

        potions.sort(key=lambda p: -p.get('heal', 0))
        needed = max_next - self.player['hp'] + 1
        chain = []
        total = 0
        for p in potions:
            chain.append(p['id'])
            total += p.get('heal', 0)
            if total >= needed:
                break
        return chain

    def _offer_emergency_potion(self, enemy, dmg, after_fn):
        """Pause lethal incoming damage so the RL policy can drink or decline."""
        max_next = self._incoming_damage_max(enemy, dmg)
        if self.player['hp'] - max_next > 0:
            return False

        chain = self._emergency_potion_chain(max_next)
        if not chain:
            return False

        self.pending_hit = {
            'dmg': dmg,
            'maxNextHit': max_next,
            'potion_chain': chain,
            'after_fn': after_fn,
        }
        return True

    def _pending_hit_snapshot(self):
        if not self.pending_hit:
            return None
        chain = list(self.pending_hit.get('potion_chain') or [])
        return {
            'dmg': self.pending_hit.get('dmg', 0),
            'maxNextHit': self.pending_hit.get('maxNextHit', 0),
            'potionChain': chain,
        }

    def resolve_emergency(self, drink):
        pending = self.pending_hit
        if not pending:
            return
        self.pending_hit = None

        if drink:
            for potion_id in list(pending.get('potion_chain') or []):
                potion = next(
                    (
                        i for i in self.items
                        if i.get('id') == potion_id
                        and i.get('carried')
                        and i.get('type') == 'potion'
                    ),
                    None,
                )
                if not potion:
                    continue
                heal = min(potion.get('heal', 0), self.player['maxHp'] - self.player['hp'])
                self.player['hp'] = round1(self.player['hp'] + heal)
                self.items = [i for i in self.items if i.get('id') != potion_id]

        after_fn = pending.get('after_fn')
        if after_fn:
            after_fn()
        if not self.pending_hit:
            self._flush_death_batch()

    def _kill_enemy(self, en, skip_advance):
        if en.get('isPet'):
            en['dying'] = True
            self._death_batch.append({'en': en, 'skipAdvanceTurn': skip_advance})
            return

        gold_drop = en['gold'] + self.rng.rand(3) + int(self._get_stat('goldBonus'))
        xp_drop = math.ceil(en['xp'] * (1 + self._get_stat('xpMult')))
        self.player['xp'] += xp_drop
        self.player['kills'] += 1
        self.player['gold'] += gold_drop

        if self._get_stat('vampirism') > 0:
            heal = self._get_stat('vampirism')
            self.player['hp'] = round1(min(self.player['maxHp'], self.player['hp'] + heal))
        if self.player['class'] == 'necromancer':
            self.player['hp'] = round1(min(self.player['maxHp'], self.player['hp'] + 2))

        en['dying'] = True
        self._death_batch.append({'en': en, 'skipAdvanceTurn': skip_advance})

    def _flush_death_batch(self):
        if not self._death_batch:
            return

        should_advance = any(not d['skipAdvanceTurn'] for d in self._death_batch)

        for d in self._death_batch:
            en = d['en']

            # Raise dead check
            if en.get('raiseCorpseTarget') and not en.get('boss') and not en.get('isPet'):
                en['isPet'] = True
                en['dying'] = False
                en['raiseCorpseTarget'] = False
                en['revive'] = False
                en['reviveTurns'] = 0
                en['hp'] = math.ceil(en['maxHp'] / 2)
                en['maxHp'] = math.ceil(en['maxHp'] / 2)
                en['lifespanTurns'] = 25
                en['petSummonedTurn'] = self.turn + (1 if should_advance else 0)
                continue

            self.enemies = [e for e in self.enemies if e['id'] != en['id']]

            if en.get('boss'):
                self.won = True
                self._check_level_up()
                return

            # Loot drops
            if en.get('isElite'):
                if self.rng.ch(0.5):
                    pool = WEAPONS + ARMORS + POTIONS + LEGENDARIES
                    w = []
                    for i in pool:
                        if i['rarity'] == 'legendary': w.append(i)
                        elif i['rarity'] == 'rare': w.extend([i, i])
                        else: w.extend([i] * 4)
                    if w:
                        drop = self.rng.choice(w)
                        self.items.append({**drop, 'x': en['x'], 'y': en['y'], 'id': self._uid(), 'carried': False})
            elif self.rng.ch(0.2):
                pool = WEAPONS + ARMORS + POTIONS
                w = []
                for i in pool:
                    if i['rarity'] == 'legendary': w.append(i)
                    elif i['rarity'] == 'rare': w.extend([i, i])
                    else: w.extend([i] * 4)
                if w:
                    drop = self.rng.choice(w)
                    self.items.append({**drop, 'x': en['x'], 'y': en['y'], 'id': self._uid(), 'carried': False})

        self._death_batch = []
        self._check_level_up()
        if should_advance:
            self._advance_turn()

    def _check_level_up(self):
        leveled = False
        while self.player['xp'] >= self.player['xpNext']:
            self.player['xp'] -= self.player['xpNext']
            self.player['lvl'] += 1
            self.player['xpNext'] = round(self.player['xpNext'] * 1.6)
            self.player['maxHp'] += 8
            self.player['hp'] = round1(min(self.player['maxHp'], self.player['hp'] + 8))
            self.player['atk'] += 1
            self.player['def'] += 1
            if self.player['class'] == 'paladin':
                self.player['maxHp'] += 2
                self.player['hp'] = round1(min(self.player['maxHp'], self.player['hp'] + 2))
            leveled = True
        if leveled:
            self._check_bag_upgrades()

    def _check_bag_upgrades(self):
        bag = [i for i in self.items if i.get('carried')]
        for it in bag:
            if self._can_equip(it):
                if it['type'] == 'weapon' and self._weapon_power(it) > self._weapon_power(self.player.get('weapon')):
                    prev = self.player.get('weapon')
                    if prev:
                        self.items = [i for i in self.items if i['id'] != prev['id']]
                        prev['carried'] = True
                        self.items.append(prev)
                    self.player['weapon'] = it
                    it['carried'] = False
                    self.items = [i for i in self.items if i['id'] != it['id']]
                elif it['type'] == 'armor' and self._armor_power(it) > self._armor_power(self.player.get('armor')):
                    prev = self.player.get('armor')
                    if prev:
                        self.items = [i for i in self.items if i['id'] != prev['id']]
                        prev['carried'] = True
                        self.items.append(prev)
                    self.player['armor'] = it
                    it['carried'] = False
                    self.items = [i for i in self.items if i['id'] != it['id']]

    # ─── TURN PROCESSING ──────────────────────────────────────────────────
    def _advance_turn(self, allow_free_move=False):
        if allow_free_move and self.player.get('freeMoves', 0) > 0:
            self.player['freeMoves'] -= 1
            self._compute_vision()
            return

        self.turn += 1
        if self.ability1_cooldown > 0: self.ability1_cooldown -= 1
        if self.ability2_cooldown > 0: self.ability2_cooldown -= 1

        p = self.player
        if p.get('shieldWallTurns', 0) > 0: p['shieldWallTurns'] -= 1
        if p.get('vanishTurns', 0) > 0: p['vanishTurns'] -= 1
        if p.get('bloodlustTurns', 0) > 0: p['bloodlustTurns'] -= 1
        if p.get('rootedTurns', 0) > 0: p['rootedTurns'] -= 1
        if p.get('strengthTurns', 0) > 0: p['strengthTurns'] -= 1
        if self.alarmed_turns > 0: self.alarmed_turns -= 1

        # Poison
        if p.get('poisonedTurns', 0) > 0:
            p['poisonedTurns'] -= 1
            pdmg = max(1, p['maxHp'] * 5 // 100)
            p['hp'] = round1(p['hp'] - pdmg)
            if p['hp'] <= 0:
                self.game_over = True
                return

        self._process_enemy_turns()

    def _process_enemy_turns(self, start_index=0):
        if self.game_over or self.won:
            return

        enemies_this_turn = list(self.enemies)
        for enemy_index in range(start_index, len(enemies_this_turn)):
            e = enemies_this_turn[enemy_index]
            if self.game_over or self.won:
                return
            if e['dying']:
                continue

            # Bear trap check
            trap_idx = next((i for i, t in enumerate(self.traps)
                             if t['type'] == 'bear' and t['x'] == e['x'] and t['y'] == e['y']), None)
            if trap_idx is not None:
                self.traps.pop(trap_idx)
                e['stunnedTurns'] = 5
                e['hp'] = round1(e['hp'] - 5)
                if e['hp'] <= 0:
                    self._kill_enemy(e, True)
                continue

            if e.get('stunnedTurns', 0) > 0:
                e['stunnedTurns'] -= 1
                continue

            if e.get('reviveTurns', 0) > 0:
                e['reviveTurns'] -= 1
                if e['reviveTurns'] <= 0:
                    e['hp'] = e['maxHp'] // 2
                    e['name'] = 'Skeleton'
                continue

            # Regen
            if e.get('regen', 0) > 0 and e['hp'] < e['maxHp']:
                heal = min(e['maxHp'] - e['hp'], e['maxHp'] * e['regen'] // 1)
                heal = int(heal)
                if heal > 0:
                    e['hp'] = round1(e['hp'] + heal)

            # Boss phase 2
            if e.get('boss') and e.get('phase') == 1 and e['hp'] <= e['maxHp'] / 2:
                e['phase'] = 2
                e['name'] = "Dungeon Lord (Enraged)"
                e['atk'] = round(e['atk'] * e.get('phaseAtkMult', 1.5))
                e['def'] = round(e['def'] * e.get('phaseDefMult', 1.5))
                summon_tiles = []
                for sy in range(e['y'] - 1, e['y'] + 2):
                    for sx in range(e['x'] - 1, e['x'] + 2):
                        if sx < 0 or sx >= MAP_W or sy < 0 or sy >= MAP_H: continue
                        if sx == e['x'] and sy == e['y']: continue
                        if sx == self.player['x'] and sy == self.player['y']: continue
                        if self.map[sy][sx] == TILE_WALL: continue

                        if any(o['x'] == sx and o['y'] == sy and not o['dying'] for o in self.enemies): continue
                        summon_tiles.append((sx, sy))
                ps = e.get('phaseSummons', 2)
                for _ in range(ps):
                    if not summon_tiles: break
                    t = ENEMIES_DATA[2]  # Skeleton
                    pick = summon_tiles.pop(self.rng.rand(len(summon_tiles)))
                    self.enemies.append({
                        **{k: v for k, v in t.items()}, 'hp': t['hp'], 'maxHp': t['hp'],
                        'x': pick[0], 'y': pick[1], 'id': self._uid(), 'stunnedTurns': 0,
                        'dying': False, 'isPet': False, 'isElite': False,
                        'revive': t.get('revive', False), 'reviveTurns': 0,
                        'enrage': False, 'regen': 0, 'vampiric': 0,
                        'freezeChance': 0, 'dodge': 0, 'boss': False,
                        'phase': 0, 'phaseAtkMult': 1.0, 'phaseDefMult': 1.0,
                        'phaseSummons': 0, 'raiseCorpseTarget': False,
                        'raiseCorpseTurns': 0, 'lifespanTurns': None, 'petSummonedTurn': None,
                    })

            # Movement / attack
            sees_player = ((e['y'] * MAP_W + e['x']) in self.visible or self.alarmed_turns > 0) and \
                          self.player.get('vanishTurns', 0) == 0

            if not sees_player:
                if self.rng.ch(0.4):
                    dirs = [(-1, 0), (1, 0), (0, -1), (0, 1)]
                    dx, dy = dirs[self.rng.rand(4)]
                    nx, ny = e['x'] + dx, e['y'] + dy
                    if 0 <= nx < MAP_W and 0 <= ny < MAP_H and self.map[ny][nx] != TILE_WALL and \
                       not (nx == self.player['x'] and ny == self.player['y']) and \
                       not any(o['x'] == nx and o['y'] == ny and o is not e for o in self.enemies):
                        e['x'] = nx
                        e['y'] = ny
                continue

            # Pick target
            if e.get('isPet'):
                hostile = [o for o in self.enemies if not o['isPet'] and not o['dying'] and
                           (o['y'] * MAP_W + o['x']) in self.visible]
                if hostile:
                    target = min(hostile, key=lambda o: abs(o['x'] - e['x']) + abs(o['y'] - e['y']))
                    target_is_player = False
                else:
                    if abs(self.player['x'] - e['x']) <= 2 and abs(self.player['y'] - e['y']) <= 2:
                        continue
                    target = self.player
                    target_is_player = True
            else:
                targets = [{'x': self.player['x'], 'y': self.player['y'], 'isPlayer': True}]
                for pet in self.enemies:
                    if pet.get('isPet') and not pet['dying']:
                        targets.append(pet)
                target = min(targets, key=lambda t: abs(t.get('x', 0) - e['x']) + abs(t.get('y', 0) - e['y']))
                target_is_player = target.get('isPlayer', False)

            tx, ty = target.get('x', 0), target.get('y', 0)
            ddx, ddy = tx - e['x'], ty - e['y']
            if abs(ddx) > abs(ddy):
                steps = [(int(math.copysign(1, ddx)) if ddx else 0, 0),
                         (0, int(math.copysign(1, ddy)) if ddy else 0)]
            else:
                steps = [(0, int(math.copysign(1, ddy)) if ddy else 0),
                         (int(math.copysign(1, ddx)) if ddx else 0, 0)]

            for sx, sy in steps:
                if sx == 0 and sy == 0:
                    continue
                nx, ny = e['x'] + sx, e['y'] + sy

                if nx == tx and ny == ty:
                    if target_is_player:
                        edm = round1(max(1, e['atk'] - self._gdef() + self.rng.rand(3)))
                        if e.get('enrage') and e['hp'] <= e['maxHp'] / 2:
                            edm = edm * 3 // 2
                        if self.player.get('shieldWallTurns', 0) > 0:
                            edm = math.ceil(edm * 3 / 5)
                        if self.player.get('bloodlustTurns', 0) > 0:
                            edm = math.ceil(edm * 23 / 20)
                        edm = round1(edm)

                        d_chance = self._player_dodge_chance()
                        if d_chance > 0 and self.rng.ch(d_chance):
                            break  # dodged, enemy turn complete
                        else:
                            def apply_enemy_hit(enemy=e, damage=edm):
                                self.player['hp'] = round1(max(0, self.player['hp'] - damage))
                                if enemy.get('vampiric') and damage > 0:
                                    heal = int(damage * enemy['vampiric'])
                                    if heal > 0:
                                        enemy['hp'] = round1(min(enemy['maxHp'], enemy['hp'] + heal))
                                if enemy.get('freezeChance') and self.rng.random() < enemy['freezeChance']:
                                    self.player['rootedTurns'] = 2
                                if self.player['hp'] <= 0:
                                    self.game_over = True
                                    return
                                self._compute_vision()

                            def resume_enemy_hit(enemy=e, damage=edm, next_index=enemy_index + 1):
                                apply_enemy_hit(enemy, damage)
                                if not self.game_over and not self.won:
                                    self._process_enemy_turns(next_index)

                            if self._offer_emergency_potion(e, edm, resume_enemy_hit):
                                return
                            apply_enemy_hit()
                    else:
                        # Attack another enemy/pet
                        t = target
                        if t.get('dodge') and self.rng.random() < t['dodge']:
                            pass
                        else:
                            edm = round1(max(1, e['atk'] - t.get('def', 0) + self.rng.rand(3)))
                            if e.get('enrage') and e['hp'] <= e['maxHp'] / 2:
                                edm = edm * 3 // 2
                            edm = round1(edm)
                            t['hp'] = round1(t.get('hp', 0) - edm)
                            if e.get('vampiric') and edm > 0:
                                heal = int(edm * e['vampiric'])
                                if heal > 0:
                                    e['hp'] = round1(min(e['maxHp'], e['hp'] + heal))
                            if t.get('hp', 0) <= 0:
                                self._kill_enemy(t, True)
                    break  # done with this enemy's turn

                if 0 <= nx < MAP_W and 0 <= ny < MAP_H and \
                   self.map[ny][nx] != TILE_WALL and \
                   not any(o['x'] == nx and o['y'] == ny and o is not e for o in self.enemies) and \
                   not (nx == self.player['x'] and ny == self.player['y']):
                    e['x'] = nx
                    e['y'] = ny
                    break

        # Post-turn: pet lifespan, raise corpse decay
        for e in list(self.enemies):
            if e['dying']:
                continue
            if e.get('raiseCorpseTurns', 0) > 0:
                e['raiseCorpseTurns'] -= 1
                if e['raiseCorpseTurns'] <= 0:
                    e['raiseCorpseTarget'] = False
            if e.get('isPet') and e.get('lifespanTurns') is not None:
                if e.get('petSummonedTurn') == self.turn:
                    e['petSummonedTurn'] = None
                    continue
                if e.get('petSummonedTurn') is not None and e['petSummonedTurn'] < self.turn:
                    e['petSummonedTurn'] = None
                e['lifespanTurns'] -= 1
                if e['lifespanTurns'] <= 0:
                    e['hp'] = 0
                    self._kill_enemy(e, True)

        self._compute_vision()

    # ─── MOVEMENT ─────────────────────────────────────────────────────────
    def step(self, action):
        """Execute a RL action dictionary."""
        if not action:
            return
        atype = action.get('type')
        if self.pending_hit:
            if atype == 'emergency':
                self.resolve_emergency(bool(action.get('drink')))
            return
        if atype == 'status':
            return
        if atype == 'click':
            target = action.get('target', '')
            if target == '#emergency-drink-btn':
                # Actually not implemented via click in python engine, but RL doesn't use emergency clicks
                return
            if target == '#drawer-backdrop':
                # close inv
                return
            if target == '#shrine-accept-btn':
                # accept shrine
                return
            if target in ('#shrine-decline-btn', '#shrine-reject-btn'):
                return
            
            # shop item click
            if 'onclick="buyItem(' in target:
                pass # not handling string clicks easily in python
            return
            
        if atype == 'wait':
            self._advance_turn(allow_free_move=True)
            return
        if atype == 'attack':
            self.tileAttack(action.get('target'))
        elif atype == 'key':
            key = action.get('val')
            if key == 'ArrowUp': self.move(0, -1)
            elif key == 'ArrowDown': self.move(0, 1)
            elif key == 'ArrowLeft': self.move(-1, 0)
            elif key == 'ArrowRight': self.move(1, 0)
            elif key in ('b', 'B', '1'): self.do_ability1()
            elif key in ('v', 'V', '2'): self.do_ability2()
            elif key in ('.', '>'): self.descend()
            elif key in ('i', 'I'): pass # toggle inv
            elif key in ('t', 'T'): self.open_shop()
            elif key == 'Escape': self.close_shop()

        if self.pending_hit:
            return
        self._flush_death_batch()

    def move(self, dx, dy):
        if self.game_over or self.won or self.map is None:
            return
        if self.player.get('rootedTurns', 0) > 0:
            self._advance_turn()
            return

        nx, ny = self.player['x'] + dx, self.player['y'] + dy
        if nx < 0 or nx >= MAP_W or ny < 0 or ny >= MAP_H or self.map[ny][nx] == TILE_WALL:

            return

        if self.map[ny][nx] == TILE_SECRET_DOOR:
            self._reveal_secret_tile(nx, ny)
            self._advance_turn()
            return

        if self.map[ny][nx] == TILE_LOCKED_DOOR:

            key_idx = next((i for i, it in enumerate(self.items) if it.get('carried') and it.get('type') == 'key'), None)
            if key_idx is not None:
                self.items.pop(key_idx)
                self.map[ny][nx] = TILE_FLOOR
                self._door_count -= 1

            return

        # Enemy collision
        en = next((e for e in self.enemies if e['x'] == nx and e['y'] == ny and not e.get('dying')), None)
        if en:
            if en.get('isPet'):
                en['x'], en['y'] = self.player['x'], self.player['y']
                self.player['x'], self.player['y'] = nx, ny
                self._advance_turn()
                return
            self._attack_enemy(en['id'])
            return

        # Trap (revealed)
        trap = next((t for t in self.traps if t['x'] == nx and t['y'] == ny and not t['triggered'] and t['type'] != 'bear'), None)
        if trap and trap.get('revealed'):
            disarm_chance = 0.3 + self._get_stat('perception') * 0.15 + (0.20 if self.player['class'] == 'rogue' else 0)
            if self.rng.ch(disarm_chance):
                trap['triggered'] = True
                self.traps = [t for t in self.traps if not (t['x'] == nx and t['y'] == ny)]
                # Grant trap disarm rewards
                floor = max(1, self.floor)
                self.player['xp'] = round1(self.player.get('xp', 0) + 2 + floor * 2)
                self.player['gold'] = round1(self.player.get('gold', 0) + self.rng.rr(5 + floor * 2, 10 + floor * 4))
                self._check_level_up()
                if self.rng.ch(0.2):
                    self._spawn_item({'x': nx, 'y': ny})
            else:
                trap['triggered'] = True
                trap_dodge = (0.5 if self.player['class'] == 'rogue' else 0) + self._get_stat('dodgeBonus')
                if not self.rng.ch(trap_dodge):
                    self._apply_trap_effect(trap, nx, ny)
            self._advance_turn()
            return

        # Move
        self.player['x'] = nx
        self.player['y'] = ny
        self._compute_vision()

        # Hidden trap
        if trap and trap['type'] != 'bear':
            trap['triggered'] = True
            trap_dodge = (0.5 if self.player['class'] == 'rogue' else 0) + self._get_stat('dodgeBonus')
            if not self.rng.ch(trap_dodge):
                self._apply_trap_effect(trap, nx, ny)

        # Pick up items on tile
        it = next((i for i in self.items if not i.get('carried') and i.get('x') == nx and i.get('y') == ny), None)
        if it:
            if it['type'] == 'key':
                self._pickup_item(it['id'], allow_free_move=True, silent=True)
            elif it['type'] == 'shrine':
                self.current_shrine = it
            else:
                self._pickup_item(it['id'], allow_free_move=True)
        else:
            self._advance_turn(allow_free_move=True)

    def _apply_trap_effect(self, trap, nx, ny):
        if trap['type'] == 'spike':
            dmg = self.player['maxHp'] * 15 // 100 + 2
            self.player['hp'] = round1(self.player['hp'] - dmg)
            if self.player['hp'] <= 0:
                self.game_over = True
        elif trap['type'] == 'gas':
            self.player['poisonedTurns'] = 5
        elif trap['type'] == 'alarm':
            self.alarmed_turns = 15
            for e in self.enemies:
                if not e['dying'] and e.get('stunnedTurns'):
                    e['stunnedTurns'] = 0

    def _pickup_item(self, item_id, allow_free_move=False, silent=False):
        it = next((i for i in self.items if i['id'] == item_id), None)
        if not it or it.get('carried'):
            return
        it['carried'] = True
        it['x'] = None
        it['y'] = None
        if it['type'] not in ('potion',):
            self._auto_equip(it)
        self._advance_turn(allow_free_move=allow_free_move)

    def accept_shrine(self):
        if not getattr(self, 'current_shrine', None):
            return
        stype = self.current_shrine.get('shrineType')
        if stype == 'Blood':
            cost = max(1, int(self.player.get('maxHp', 1) * 0.3))
            atk_gain = max(1, cost // 12)
            self.player['maxHp'] = max(1, self.player['maxHp'] - cost)
            self.player['hp'] = min(self.player['hp'], self.player['maxHp'])
            self.player['atk'] += atk_gain
        elif stype == 'Greed':
            self.player['gold'] = 0
            for _ in range(2):
                self.player['lvl'] += 1
                self.player['xpNext'] = js_round(self.player['xpNext'] * 1.6)
                self.player['maxHp'] = round1(self.player['maxHp'] + 8)
                self.player['hp'] = round1(min(self.player['maxHp'], self.player['hp'] + 8))
                self.player['atk'] = round1(self.player['atk'] + 1)
                self.player['def'] = round1(self.player['def'] + 1)
                if self.player['class'] == 'paladin':
                    self.player['maxHp'] = round1(self.player['maxHp'] + 2)
                    self.player['hp'] = round1(min(self.player['maxHp'], self.player['hp'] + 2))
            self._check_bag_upgrades()
        elif stype == 'Cursed':
            self.player['hp'] = self.player['maxHp']

            profile = FLOOR_ENEMY_PROFILES[max(0, min(self.floor - 1, len(FLOOR_ENEMY_PROFILES) - 1))]
            spawned = 0
            for radius in range(1, 3):
                if spawned >= 3:
                    break
                for y in range(self.player['y'] - radius, self.player['y'] + radius + 1):
                    if spawned >= 3:
                        break
                    for x in range(self.player['x'] - radius, self.player['x'] + radius + 1):
                        if spawned >= 3:
                            break
                        if not (0 <= y < len(self.map) and 0 <= x < len(self.map[0])):
                            continue
                        if self.map[y][x] != TILE_FLOOR or (x == self.player['x'] and y == self.player['y']):
                            continue
                        if any(e['x'] == x and e['y'] == y for e in self.enemies):
                            continue

                        tier = self.rng.rr(profile['tierMin'], profile['tierMax'])
                        base_data = ENEMIES_DATA[tier]
                        scale = profile['scale']
                        self.enemies.append({
                            **{k: v for k, v in base_data.items()},
                            'name': 'Cursed ' + base_data['name'],
                            'hp': js_round(base_data.get('hp', 25) * scale) * 2,
                            'maxHp': js_round(base_data.get('hp', 25) * scale) * 2,
                            'atk': js_round(base_data.get('atk', 9) * scale) * 2,
                            'def': js_round(base_data.get('def', 0) * scale),
                            'xp': js_round(base_data.get('xp', 0) * scale) * 2,
                            'gold': js_round(base_data.get('gold', 0) * scale) * 2,
                            'x': x, 'y': y, 'id': self._uid(), 'stunnedTurns': 0,
                            'dying': False, 'isPet': False, 'isElite': True,
                            'revive': base_data.get('revive', False), 'reviveTurns': 0,
                            'enrage': base_data.get('enrage', False), 'regen': base_data.get('regen', 0),
                            'vampiric': base_data.get('vampiric', 0),
                            'freezeChance': base_data.get('freezeChance', 0),
                            'dodge': base_data.get('dodge', 0),
                            'boss': False,
                            'phase': 0, 'phaseAtkMult': 1.0, 'phaseDefMult': 1.0,
                            'phaseSummons': 0, 'raiseCorpseTarget': False,
                            'raiseCorpseTurns': 0, 'lifespanTurns': None, 'petSummonedTurn': None,
                        })
                        spawned += 1

        self.items = [i for i in self.items if i.get('id') != self.current_shrine.get('id')]
        self.current_shrine = None
        self._advance_turn(allow_free_move=True)

    def decline_shrine(self):
        if not getattr(self, 'current_shrine', None):
            return
        self.current_shrine = None
        self._advance_turn(allow_free_move=True)

    def _auto_equip(self, it):
        if it['type'] == 'weapon':
            if self._can_equip(it) and self._weapon_power(it) > self._weapon_power(self.player.get('weapon')):
                prev = self.player.get('weapon')
                if prev:
                    self.items = [i for i in self.items if i['id'] != prev['id']]
                    prev['carried'] = True
                    self.items.append(prev)
                self.player['weapon'] = it
                it['carried'] = False
                self.items = [i for i in self.items if i['id'] != it['id']]
        elif it['type'] == 'armor':
            if self._can_equip(it) and self._armor_power(it) > self._armor_power(self.player.get('armor')):
                prev = self.player.get('armor')
                if prev:
                    self.items = [i for i in self.items if i['id'] != prev['id']]
                    prev['carried'] = True
                    self.items.append(prev)
                self.player['armor'] = it
                it['carried'] = False
                self.items = [i for i in self.items if i['id'] != it['id']]

    # ─── ITEMS / ABILITIES ────────────────────────────────────────────────
    def use_item(self, item_type):
        """Use an item by type (simplified for RL actions)."""
        if self.game_over or self.won:
            return

        if item_type == 'potion':
            it = next((i for i in self.items if i.get('carried') and i.get('type') == 'potion'), None)
            if not it or self.player['hp'] >= self.player['maxHp']:
                return
            h = min(it['heal'], self.player['maxHp'] - self.player['hp'])
            self.player['hp'] = round1(self.player['hp'] + h)
            self.items = [i for i in self.items if i['id'] != it['id']]
            self._advance_turn()
        elif item_type == 'potion_buff':
            it = next((i for i in self.items if i.get('carried') and i.get('type') == 'potion_buff'), None)
            if not it:
                return
            if it.get('buff') == 'strength':
                self.player['strengthTurns'] = 10
            self.items = [i for i in self.items if i['id'] != it['id']]
            self._advance_turn()
        elif item_type == 'bomb':
            it = next((i for i in self.items if i.get('carried') and i.get('type') == 'bomb'), None)
            if not it:
                return
            kills = []
            for y in range(self.player['y'] - 1, self.player['y'] + 2):
                for x in range(self.player['x'] - 1, self.player['x'] + 2):
                    en = next((e for e in self.enemies if e['x'] == x and e['y'] == y and not e['dying']), None)
                    if en:
                        en['hp'] = round1(en['hp'] - 30)
                        if en['hp'] <= 0:
                            kills.append(en)
            for en in kills:
                self._kill_enemy(en, True)
            self.items = [i for i in self.items if i['id'] != it['id']]
            self._advance_turn()
        elif item_type == 'scroll_teleport':
            it = next((i for i in self.items if i.get('carried') and i.get('type') == 'scroll_teleport'), None)
            if not it:
                return
            safe = self._get_teleport_safe_tiles()
            if safe:
                t = self.rng.choice(safe)
                self.player['x'] = t[0]
                self.player['y'] = t[1]
                self._compute_vision()
            self.items = [i for i in self.items if i['id'] != it['id']]
            self._advance_turn()
        elif item_type == 'scroll':
            it = next((i for i in self.items if i.get('carried') and i.get('type') == 'scroll' and 'detection' in i.get('name', '').lower()), None)
            if not it:
                return
            for y in range(MAP_H):
                for x in range(MAP_W):
                    if self.map[y][x] == TILE_SECRET_DOOR:
                        self._reveal_secret_tile(x, y)

                    for trap in self.traps:
                        if trap['x'] == x and trap['y'] == y and not trap.get('revealed'):
                            trap['revealed'] = True
            self.items = [i for i in self.items if i['id'] != it['id']]
            self._advance_turn()

    def _get_teleport_safe_tiles(self):
        safe = []
        for y in range(1, MAP_H - 1):
            for x in range(1, MAP_W - 1):
                if self.map[y][x] == TILE_FLOOR and \
                   not any(trap['x'] == x and trap['y'] == y for trap in self.traps) and \
                   not any(e['x'] == x and e['y'] == y and not e['dying'] for e in self.enemies) and \
                   (x != self.player['x'] or y != self.player['y']):
                    safe.append((x, y))
        return safe

    def descend(self):
        if self.game_over or self.won:
            return
        if self.map[self.player['y']][self.player['x']] != TILE_STAIRS:
            return
        self.floor += 1
        if self.floor > FLOORS:
            self.won = True
            return
        self.player['hp'] = round1(min(self.player['maxHp'], self.player['hp'] + 10))
        self.player['poisonedTurns'] = 0
        self._build_floor()

    def do_ability1(self):
        if self.game_over or self.won:
            return
        if self.ability1_cooldown > 0:
            return

        p = self.player
        vis_enemies = [e for e in self.enemies if not e['dying'] and (e['y'] * MAP_W + e['x']) in self.visible]

        if p['class'] == 'warrior':
            t = [e for e in vis_enemies if abs(e['x'] - p['x']) <= 2 and abs(e['y'] - p['y']) <= 2]
            t.sort(key=lambda e: abs(e['x'] - p['x']) + abs(e['y'] - p['y']))
            if t:
                self.ability1_cooldown = 5
                self._attack_enemy(t[0]['id'], 1.5)
        elif p['class'] == 'rogue':
            p['freeMoves'] = 2
            self.ability1_cooldown = 3
        elif p['class'] == 'mage':
            t = sorted(vis_enemies, key=lambda e: abs(e['x'] - p['x']) + abs(e['y'] - p['y']))
            if t:
                self.ability1_cooldown = 5
                target = t[0]
                hits = []
                for e in list(self.enemies):
                    if not e['dying'] and abs(e['x'] - target['x']) <= 1 and abs(e['y'] - target['y']) <= 1:
                        dmg = round1(max(1, self._gatk() - e['def'] + self.rng.rand(3)))
                        e['hp'] = round1(e['hp'] - dmg)
                        p['damageDealt'] = round1(p.get('damageDealt', 0) + dmg)
                        if e['hp'] <= 0:
                            hits.append(e)
                if hits:
                    for i, en in enumerate(hits):
                        self._kill_enemy(en, i < len(hits) - 1)
                else:
                    self._advance_turn()
        elif p['class'] == 'paladin':
            t = [e for e in vis_enemies if abs(e['x'] - p['x']) <= 2 and abs(e['y'] - p['y']) <= 2]
            t.sort(key=lambda e: abs(e['x'] - p['x']) + abs(e['y'] - p['y']))
            if t:
                self.ability1_cooldown = 5
                t[0]['stunnedTurns'] = 1
                self._attack_enemy(t[0]['id'], 1)
        elif p['class'] == 'ranger':
            # Find enemies in line
            candidates = []
            for e in vis_enemies:
                ddx, ddy = e['x'] - p['x'], e['y'] - p['y']
                aligned = ddx == 0 or ddy == 0 or abs(ddx) == abs(ddy)
                if not aligned:
                    continue
                sx = (1 if ddx > 0 else -1) if ddx != 0 else 0
                sy = (1 if ddy > 0 else -1) if ddy != 0 else 0
                cx, cy = p['x'] + sx, p['y'] + sy
                clear = True
                while cx != e['x'] or cy != e['y']:
                    if cx < 0 or cx >= MAP_W or cy < 0 or cy >= MAP_H or self.map[cy][cx] == TILE_WALL:

                        clear = False
                        break
                    cx += sx
                    cy += sy
                if clear:
                    candidates.append((e, sx, sy, abs(ddx) + abs(ddy)))
            candidates.sort(key=lambda c: c[3])
            if candidates:
                self.ability1_cooldown = 4
                _, sx, sy, _ = candidates[0]
                cx, cy = p['x'] + sx, p['y'] + sy
                hits = []
                while 0 <= cx < MAP_W and 0 <= cy < MAP_H and self.map[cy][cx] != TILE_WALL:
                    e = next((e for e in self.enemies if e['x'] == cx and e['y'] == cy and not e['dying']), None)
                    if e:
                        dmg = round1(max(1, self._gatk() - e['def'] + self.rng.rand(3)))
                        e['hp'] = round1(e['hp'] - dmg)
                        p['damageDealt'] = round1(p.get('damageDealt', 0) + dmg)
                        if e['hp'] <= 0:
                            hits.append(e)
                    cx += sx
                    cy += sy
                if hits:
                    for i, en in enumerate(hits):
                        self._kill_enemy(en, i < len(hits) - 1)
                else:
                    self._advance_turn()
        elif p['class'] == 'barbarian':
            targets = [e for e in self.enemies if not e['dying'] and abs(e['x'] - p['x']) <= 1 and abs(e['y'] - p['y']) <= 1]
            if not targets:
                return
            self.ability1_cooldown = 4
            hits = []
            for e in targets:
                dmg = round1(max(1, self._gatk() - e['def'] + self.rng.rand(3)))
                e['hp'] = round1(e['hp'] - dmg)
                p['damageDealt'] = round1(p.get('damageDealt', 0) + dmg)
                if e['hp'] <= 0:
                    hits.append(e)
            if hits:
                for i, en in enumerate(hits):
                    self._kill_enemy(en, i < len(hits) - 1)
            else:
                self._advance_turn()
        elif p['class'] == 'necromancer':
            t = [e for e in vis_enemies if abs(e['x'] - p['x']) <= 2 and abs(e['y'] - p['y']) <= 2]
            t.sort(key=lambda e: abs(e['x'] - p['x']) + abs(e['y'] - p['y']))
            if t:
                self.ability1_cooldown = 5
                en = t[0]
                dmg = round1(max(1, self._gatk() - en['def'] + self.rng.rand(3)))
                en['hp'] = round1(en['hp'] - dmg)
                p['damageDealt'] = round1(p.get('damageDealt', 0) + dmg)
                heal = dmg
                p['hp'] = round1(min(p['maxHp'], p['hp'] + heal))
                if en['hp'] <= 0:
                    self._kill_enemy(en, False)
                else:
                    self._advance_turn()
        elif p['class'] == 'monk':
            t = [e for e in vis_enemies if abs(e['x'] - p['x']) <= 1 and abs(e['y'] - p['y']) <= 1]
            t.sort(key=lambda e: abs(e['x'] - p['x']) + abs(e['y'] - p['y']))
            if t:
                self.ability1_cooldown = 3
                en = t[0]
                ddx = 1 if en['x'] > p['x'] else (-1 if en['x'] < p['x'] else 0)
                ddy = 1 if en['y'] > p['y'] else (-1 if en['y'] < p['y'] else 0)
                pushx, pushy = en['x'] + ddx, en['y'] + ddy
                dmg = round1(max(1, self._gatk() - en['def'] + self.rng.rand(3)))
                if 0 <= pushx < MAP_W and 0 <= pushy < MAP_H and self.map[pushy][pushx] != TILE_WALL and \
                   not any(e['x'] == pushx and e['y'] == pushy for e in self.enemies):
                    en['x'] = pushx
                    en['y'] = pushy
                else:
                    dmg = round1(dmg * 2)
                en['hp'] = round1(en['hp'] - dmg)
                p['damageDealt'] = round1(p.get('damageDealt', 0) + dmg)
                if en['hp'] <= 0:
                    self._kill_enemy(en, False)
                else:
                    self._advance_turn()

    def do_ability2(self):
        p = self.player
        if self.game_over or self.won or p['lvl'] < 5:
            return
        if self.ability2_cooldown > 0:
            return

        if p['class'] == 'warrior':
            p['shieldWallTurns'] = 3
            self.ability2_cooldown = 10
            self._advance_turn()
        elif p['class'] == 'rogue':
            p['vanishTurns'] = 3
            self.ability2_cooldown = 10
            self._advance_turn()
        elif p['class'] == 'mage':
            safe = []
            for y in range(MAP_H):
                for x in range(MAP_W):
                    if (y * MAP_W + x) in self.visible and self.map[y][x] == TILE_FLOOR and \
                       (x != p['x'] or y != p['y']) and \
                       not any(e['x'] == x and e['y'] == y for e in self.enemies if not e['dying']) and \
                       not any(t['x'] == x and t['y'] == y and not t['triggered'] for t in self.traps):
                        safe.append((x, y))
            if safe:
                live = [e for e in self.enemies if not e['dying']]
                if live:
                    for i, t in enumerate(safe):
                        safe[i] = (t[0], t[1], min(max(abs(e['x'] - t[0]), abs(e['y'] - t[1])) for e in live))
                    max_dist = max(s[2] for s in safe)
                    safe = [(s[0], s[1]) for s in safe if s[2] == max_dist]
                else:
                    safe = [(s[0], s[1]) for s in safe]
                t = self.rng.choice(safe)
                p['x'] = t[0]
                p['y'] = t[1]
                self.ability2_cooldown = 8
                self._advance_turn()
        elif p['class'] == 'paladin':
            heal = p['maxHp'] * 20 // 100
            p['hp'] = round1(min(p['maxHp'], p['hp'] + heal))
            self.ability2_cooldown = 15
            self._advance_turn()
        elif p['class'] == 'ranger':
            self.traps.append({'x': p['x'], 'y': p['y'], 'type': 'bear', 'revealed': True, 'triggered': False})
            safe_adj = []
            for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                nx, ny = p['x'] + dx, p['y'] + dy
                if 0 <= nx < MAP_W and 0 <= ny < MAP_H and self.map[ny][nx] == TILE_FLOOR and \
                   not any(e['x'] == nx and e['y'] == ny for e in self.enemies if not e['dying']):
                    safe_adj.append((nx, ny))
            if safe_adj:
                vis_enemies = [e for e in self.enemies if not e['dying'] and (e['y'] * MAP_W + e['x']) in self.visible]
                if vis_enemies:
                    for i, t in enumerate(safe_adj):
                        safe_adj[i] = (t[0], t[1], min(max(abs(e['x'] - t[0]), abs(e['y'] - t[1])) for e in vis_enemies))
                    safe_adj.sort(key=lambda s: -s[2])
                    best_dist = safe_adj[0][2]
                    best = [s for s in safe_adj if s[2] == best_dist]
                    pick = self.rng.choice(best)
                    p['x'] = pick[0]
                    p['y'] = pick[1]
                else:
                    pick = self.rng.choice(safe_adj)
                    p['x'] = pick[0]
                    p['y'] = pick[1]
            self.ability2_cooldown = 10
            self._advance_turn()
        elif p['class'] == 'barbarian':
            p['bloodlustTurns'] = 3
            self.ability2_cooldown = 12
            self._advance_turn()
        elif p['class'] == 'necromancer':
            vis_enemies = [e for e in self.enemies if not e['dying'] and (e['y'] * MAP_W + e['x']) in self.visible]
            t = [e for e in vis_enemies if not e.get('boss') and not e.get('isPet') and not e.get('raiseCorpseTarget')]
            t.sort(key=lambda e: abs(e['x'] - p['x']) + abs(e['y'] - p['y']))
            if t:
                t[0]['raiseCorpseTarget'] = True
                t[0]['raiseCorpseTurns'] = 3
                self.ability2_cooldown = 8
                self._advance_turn()
        elif p['class'] == 'monk':
            vis_enemies = [e for e in self.enemies if not e['dying'] and (e['y'] * MAP_W + e['x']) in self.visible]
            t = [e for e in vis_enemies if abs(e['x'] - p['x']) <= 1 and abs(e['y'] - p['y']) <= 1]
            t.sort(key=lambda e: abs(e['x'] - p['x']) + abs(e['y'] - p['y']))
            if t:
                self.ability2_cooldown = 10
                p['rootedTurns'] = 2
                en = t[0]
                for i in range(3):
                    if en['dying'] or en['hp'] <= 0:
                        break
                    mult = 1
                    if i == 0 and p.get('vanishTurns', 0) > 0:
                        mult *= 2
                        p['vanishTurns'] = 0
                    if self._get_stat('critChance') > 0 and self.rng.random() < self._get_stat('critChance'):
                        mult *= 2
                    if en.get('dodge') and self.rng.random() < en['dodge']:
                        continue
                    dmg = round1(max(1, self._gatk() - en['def'] + self.rng.rand(3)))
                    if mult > 1:
                        dmg = round1(dmg * mult)
                    en['hp'] = round1(en['hp'] - dmg)
                    p['damageDealt'] = round1(p.get('damageDealt', 0) + dmg)
                    if p.get('bloodlustTurns', 0) > 0:
                        heal = dmg // 2
                        if heal > 0:
                            p['hp'] = round1(min(p['maxHp'], p['hp'] + heal))
                    if en['hp'] <= 0:
                        if en.get('reviveTurns', 0) > 0:
                            self._kill_enemy(en, False)
                            return
                        elif en.get('revive'):
                            en['revive'] = False
                            en['reviveTurns'] = 2
                            en['hp'] = 0
                            en['name'] = 'Bones'
                        else:
                            self._kill_enemy(en, False)
                            return
                # Counter after flurry
                if not en['dying'] and en.get('stunnedTurns', 0) <= 0:
                    edm = round1(max(1, en['atk'] - self._gdef() + self.rng.rand(3)))
                    if en.get('enrage') and en['hp'] <= en['maxHp'] / 2:
                        edm = edm * 3 // 2
                    if p.get('shieldWallTurns', 0) > 0:
                        edm = math.ceil(edm * 3 / 5)
                    if p.get('bloodlustTurns', 0) > 0:
                        edm = math.ceil(edm * 23 / 20)
                    edm = round1(edm)
                    dodge = self._player_dodge_chance()
                    if not (dodge > 0 and self.rng.ch(dodge)):
                        def apply_flurry_counter():
                            p['hp'] = round1(max(0, p['hp'] - edm))
                            if en.get('vampiric') and edm > 0:
                                heal = int(edm * en['vampiric'])
                                if heal > 0:
                                    en['hp'] = round1(min(en['maxHp'], en['hp'] + heal))
                            if en.get('freezeChance') and self.rng.random() < en['freezeChance']:
                                p['rootedTurns'] = 2
                            if p['hp'] <= 0:
                                self.game_over = True

                        if self._offer_emergency_potion(en, edm, apply_flurry_counter):
                            return
                        apply_flurry_counter()
                self._advance_turn()

    # ─── SHOP ACTIONS ─────────────────────────────────────────────────────
    def open_shop(self):
        if self.game_over or self.won:
            return
        p = self.player
        near_shop = next((s for s in self.shops if abs(p['x'] - s['x']) <= 1 and abs(p['y'] - s['y']) <= 1), None)
        if near_shop:
            self.current_shop = near_shop

    def close_shop(self):
        self.current_shop = None
        self.current_shrine = None

    def buy_item(self, item_id):
        if not self.current_shop:
            return
        item = next((i for i in self.current_shop['stock'] if i['id'] == item_id), None)
        if not item or item.get('sold'):
            return
        if self.player['gold'] < item['price']:
            return
        self.player['gold'] -= item['price']
        item['sold'] = True

        if item['type'] in ('potion', 'potion_buff', 'bomb', 'scroll', 'scroll_teleport'):
            clone = {**item, 'carried': True, 'id': self._uid()}
            self.items.append(clone)
        elif item['type'] in ('weapon', 'armor'):
            clone = {**item, 'carried': True, 'id': self._uid()}
            self.items.append(clone)
            self._auto_equip(clone)
        elif item['type'] == 'upgrade':
            self._apply_upgrade(item)

    def buy_shop_slot(self, slot):
        if not self.current_shop:
            return
        stock = self.current_shop.get('stock', [])
        if slot < 0 or slot >= len(stock):
            return
        item = stock[slot]
        if not item or item.get('sold'):
            return
        if item.get('price', 0) > self.player.get('gold', 0):
            return
        self.buy_item(item['id'])

    def sell_weaker_gear(self):
        if not self.current_shop:
            return
        to_sell = []
        new_items = []
        for it in self.items:
            if not it.get('carried'):
                new_items.append(it)
                continue
            if it['type'] in ('weapon', 'armor'):
                if (self.player.get('weapon') and self.player['weapon']['id'] == it['id']) or \
                   (self.player.get('armor') and self.player['armor']['id'] == it['id']):
                    new_items.append(it)
                    continue
                unusable = it.get('reqClass') and self.player['class'] not in it['reqClass']
                if unusable:
                    to_sell.append(it)
                elif it['type'] == 'weapon' and self._weapon_power(it) <= self._weapon_power(self.player.get('weapon')):
                    to_sell.append(it)
                elif it['type'] == 'armor' and self._armor_power(it) <= self._armor_power(self.player.get('armor')):
                    to_sell.append(it)
                else:
                    new_items.append(it)
            else:
                new_items.append(it)
        if to_sell:
            total_gold = sum(max(1, (it.get('price', 10) // 2)) for it in to_sell)
            self.items = new_items
            self.player['gold'] += total_gold

    def tileAttack(self, en_id):
        """Attack or move toward an enemy (matches JS tileAttack)."""
        en = next((e for e in self.enemies if e['id'] == en_id), None)
        if not en or en.get('dying'):
            return
        if en.get('isPet'):
            dx = en['x'] - self.player['x']
            dy = en['y'] - self.player['y']
            if abs(dx) <= 1 and abs(dy) <= 1:
                en['x'], en['y'] = self.player['x'], self.player['y']
                self.player['x'] += dx
                self.player['y'] += dy
                self._advance_turn()
            else:
                if self.player.get('rootedTurns', 0) > 0:
                    return
                sdx = (1 if dx > 0 else -1) if dx != 0 else 0
                sdy = (1 if dy > 0 else -1) if dy != 0 else 0
                self.move(sdx, sdy)
            return

        max_range = 3 if (self.player['class'] == 'ranger' and self.player.get('weapon') and self.player['weapon'].get('sym') == '🏹') else 2
        dist = max(abs(en['x'] - self.player['x']), abs(en['y'] - self.player['y']))
        if dist <= max_range:
            ranged_bow = (self.player['class'] == 'ranger' and self.player.get('weapon') and
                          self.player['weapon'].get('sym') == '🏹' and dist >= 3)
            self._attack_enemy(en['id'], 1, skip_counter=ranged_bow)
        else:
            if self.player.get('rootedTurns', 0) > 0:
                return
            sdx = (1 if en['x'] > self.player['x'] else -1) if en['x'] != self.player['x'] else 0
            sdy = (1 if en['y'] > self.player['y'] else -1) if en['y'] != self.player['y'] else 0
            self.move(sdx, sdy)

    # ─── SNAPSHOT (matches JS captureSnapshot for RL compatibility) ───────
    def observe_into(self, arrays, index: int, prev_action=None):
        from observation import observe_game_into
        return observe_game_into(self, arrays, index, prev_action)

    def snapshot(self):
        """Return a state dict compatible with the existing RL pipeline."""
        p = self.player
        return {
            'ready': True,
            'floor': self.floor,
            'hardMode': bool(self.hard_mode),
            'rCount': self.rng.r_count,
            'turn': self.turn,
            'rooms': [r.get('type') for r in self.rooms],
            'player': {
                'hp': p['hp'], 'maxHp': p['maxHp'], 'atk': p['atk'], 'def': p['def'],
                'lvl': p['lvl'], 'xp': p['xp'], 'xpNext': p['xpNext'], 'gold': p['gold'],
                'x': p['x'], 'y': p['y'], 'class': p['class'],
                'weapon': {'atk': p['weapon']['atk'], 'sym': p['weapon'].get('sym',''), 'name': p['weapon']['name'], 'id': p['weapon']['id'],
                           'vampirism': p['weapon'].get('vampirism', 0), 'critChance': p['weapon'].get('critChance', 0),
                           'perception': p['weapon'].get('perception', 0), 'swiftness': p['weapon'].get('swiftness', 0),
                           'dodgeBonus': p['weapon'].get('dodgeBonus', 0), 'regen': p['weapon'].get('regen', 0)}
                    if p.get('weapon') else None,
                'armor': {'def': p['armor']['def'], 'name': p['armor']['name'], 'id': p['armor']['id'],
                          'dodgeBonus': p['armor'].get('dodgeBonus', 0), 'perception': p['armor'].get('perception', 0),
                          'swiftness': p['armor'].get('swiftness', 0), 'critChance': p['armor'].get('critChance', 0)}
                    if p.get('armor') else None,
                'shieldWallTurns': p.get('shieldWallTurns', 0),
                'vanishTurns': p.get('vanishTurns', 0),
                'freeMoves': p.get('freeMoves', 0),
                'bloodlustTurns': p.get('bloodlustTurns', 0),
                'rootedTurns': p.get('rootedTurns', 0),
                'poisonedTurns': p.get('poisonedTurns', 0),
                'strengthTurns': p.get('strengthTurns', 0),
                'vampirism': p.get('vampirism', 0),
                'regen': p.get('regen', 0),
                'swiftness': p.get('swiftness', 0),
                'critChance': p.get('critChance', 0),
                'dodgeBonus': p.get('dodgeBonus', 0),
                'goldBonus': p.get('goldBonus', 0),
                'xpMult': p.get('xpMult', 0),
                'perception': p.get('perception', 0),
                'tilesExplored': p.get('tilesExplored', 0),
            },
            'ability1Cooldown': self.ability1_cooldown,
            'ability2Cooldown': self.ability2_cooldown,
            'enemies': [
                {'id': e['id'], 'x': e['x'], 'y': e['y'], 'hp': e['hp'], 'maxHp': e['maxHp'],
                 'atk': e['atk'], 'def': e['def'], 'xp': e.get('xp', 0), 'gold': e.get('gold', 0),
                 'boss': bool(e.get('boss')), 'isElite': bool(e.get('isElite')),
                 'dying': bool(e.get('dying')), 'isPet': bool(e.get('isPet'))}
                for e in self.enemies
            ],
            'items': [
                {'id': i['id'], 'name': i.get('name',''), 'type': i.get('type',''),
                 'carried': bool(i.get('carried')),
                 'x': i.get('x'), 'y': i.get('y'),
                 'heal': i.get('heal', 0), 'price': i.get('price', 0),
                 'atk': i.get('atk', 0), 'def': i.get('def', 0),
                 'sold': bool(i.get('sold', False))}
                for i in self.items
            ],
            'traps': [
                {'x': t['x'], 'y': t['y'], 'type': t['type'],
                 'revealed': bool(t.get('revealed')), 'triggered': bool(t.get('triggered'))}
                for t in self.traps
            ],
            'shops': [
                {'x': s['x'], 'y': s['y'],
                 'stock': [{'id': i['id'], 'type': i.get('type',''), 'price': i.get('price',0),
                            'heal': i.get('heal',0), 'atk': i.get('atk',0), 'def': i.get('def',0),
                            'amount': i.get('amount',0), 'stat': i.get('stat',''),
                            'rarity': i.get('rarity',''), 'sold': bool(i.get('sold',False)),
                            'name': i.get('name','')}
                           for i in s.get('stock', [])]}
                for s in self.shops
            ],
            'currentShop': {
                'x': self.current_shop['x'], 'y': self.current_shop['y'],
                'stock': [{'id': i['id'], 'type': i.get('type',''), 'price': i.get('price',0),
                           'heal': i.get('heal',0), 'atk': i.get('atk',0), 'def': i.get('def',0),
                           'amount': i.get('amount',0), 'stat': i.get('stat',''),
                           'rarity': i.get('rarity',''), 'sold': bool(i.get('sold',False)),
                           'name': i.get('name','')}
                          for i in self.current_shop.get('stock', [])]
            } if self.current_shop else None,
            'map': self.map,
            'seen': list(self.seen),
            'visible': list(self.visible),
            'seen_count': len(self.seen),
            'known_stairs': self._known_stairs(),
            '_door_count': self._door_count,
            '_secret_count': self._secret_count,
            '_walkable_total': self._walkable_total,
            'shopOpen': self.current_shop is not None,
            'shrineOpen': getattr(self, 'current_shrine', None) is not None,
            '_stair_coords': self._stair_coords,
            'pendingHit': self._pending_hit_snapshot(),
            'gameOver': self.game_over,
            'won': self.won,
        }

    def _known_stairs(self):
        for x, y in self._stair_coords:
            if (y * MAP_W + x) in self.seen:
                return True
        return False
