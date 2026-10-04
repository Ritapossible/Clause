# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import datetime
import hashlib
import json
_A = 'funded'
_B = 'in_review'
_C = 'disputed'
_D = 'failed'
_E = 'released'
_F = 'refunded'
_G = 'unmet'
_H = 'met'
_I = 'undetermined'
_J = (_G, _H, _I)
_K = 8
_L = 24
_M = 8
_N = 12
_O = 400
_P = 60
_Q = 90 * 86400
_R = 2000
_S = 120
_T = 1000
_U = 10000
_V = ('delivery_seconds', 'review_seconds', 'redelivery_seconds', 'ruling_seconds')
_W = ('good', 'great', 'nice', 'quality', 'high-quality', 'professional', 'satisfactory', 'appropriate', 'reasonable', 'excellent', 'clean', 'polished', 'beautiful', 'best', 'acceptable', 'adequate', 'well', 'properly', 'decent', 'impressive', 'engaging')
_X = ('json', 'csv', 'yaml', 'xml', 'html', 'markdown', 'pdf', 'png', 'jpg', 'svg', 'url', 'urls', 'link', 'links', 'key', 'keys', 'field', 'fields', 'column', 'columns', 'row', 'rows', 'section', 'sections', 'heading', 'headings', 'header', 'word', 'words', 'line', 'lines', 'item', 'items', 'name', 'names', 'file', 'files', 'page', 'pages', 'sentence', 'sentences', 'paragraph', 'paragraphs', 'character', 'characters', 'table', 'list', 'image', 'images', 'language', 'english', 'french', 'spanish', 'format', 'title', 'email', 'date', 'dates')

class _Y(ValueError):
 pass

def _Z(value, context):
 if isinstance(value, bool) or not isinstance(value, int):
  raise _Y('%s: expected an integer, got %r' % (context, value))
 return value

def _AA(value, context='address'):
 _b = str(value).strip().lower()
 if not _b.startswith('0x') or len(_b) != 42:
  raise _Y('%s: not an address: %r' % (context, value))
 for ch in _b[2:]:
  if ch not in '0123456789abcdef':
   raise _Y('%s: not hex: %r' % (context, value))
 return _b

def _AB(value):
 _b = str(value).strip().lower()
 if len(_b) != 64:
  return False
 for ch in _b:
  if ch not in '0123456789abcdef':
   return False
 return True

def _AC(text):
 _b = []
 _c = ''
 for ch in str(text).lower():
  if ch.isalnum() or ch == '-':
   _c += ch
  else:
   if _c:
    _b.append(_c)
   _c = ''
 if _c:
  _b.append(_c)
 return _b

def _AD(test):
 _e = str(test).strip()
 if len(_e) < _N:
  return 'the acceptance test is under %d characters' % _N
 if len(_e) > _O:
  return 'the acceptance test is longer than %d characters' % _O
 _g = _AC(_e)
 for w in _g:
  if w in _W:
   return 'the acceptance test relies on taste (%r)' % w
 _c = any((ch.isdigit() for ch in _e))
 _d = _e.count('"') >= 2 or _e.count("'") >= 2
 _b = any((w in _X for w in _g))
 if not (_c or _d or _b):
  return 'the acceptance test names nothing checkable (a number, a quoted value, or a key/section/word count)'
 return ''

def _AE(cid):
 _b = str(cid)
 if len(_b) < 1 or len(_b) > _L:
  return 'a clause id is 1-%d characters' % _L
 for ch in _b:
  if ch not in 'abcdefghijklmnopqrstuvwxyz0123456789-_':
   return 'a clause id is lowercase letters, digits, - and _: %r' % _b
 return ''

def _AF(text):
 return text != '' and all((ch in '0123456789' for ch in text))

def _AG(locate):
 _c = str(locate)
 if _c == '':
  return ''
 if _c.startswith('bytes:'):
  _b = _c[6:].split('-')
  if len(_b) != 2 or not _AF(_b[0]) or (not _AF(_b[1])):
   return 'a byte span is bytes:START-END'
  if int(_b[1]) <= int(_b[0]) or int(_b[1]) - int(_b[0]) > _R:
   return 'a byte span covers 1-%d bytes' % _R
  return ''
 if _c.startswith('/'):
  if len(_c) > _S:
   return 'a JSON pointer is at most %d characters' % _S
  for ch in _c:
   if ch not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/_-~.':
    return 'a JSON pointer uses letters, digits and / _ - ~ .'
  return ''
 return 'a location is a byte span (bytes:START-END) or a JSON pointer (/key/0)'

def _AH(clauses, *, value, timing, buyer, seller):
 _f = []
 if not isinstance(clauses, list) or not clauses:
  return ['the spec needs at least one clause']
 if len(clauses) > _K:
  _f.append('at most %d clauses' % _K)
 _k = set()
 _l = 0
 for i, c in enumerate(clauses):
  _n = 'clause %d' % (i + 1)
  if not isinstance(c, dict):
   _f.append('%s: not an object' % _n)
   continue
  _h = set(c.keys()) - {'id', 'criterion', 'test', 'amount'}
  if _h:
   _f.append('%s: unknown fields %s' % (_n, sorted(_h)))
  _c = c.get('id', '')
  e = _AE(_c)
  if e:
   _f.append('%s: %s' % (_n, e))
  elif _c in _k:
   _f.append('%s: duplicate id %r' % (_n, _c))
  _k.add(_c)
  _d = str(c.get('criterion', '')).strip()
  if len(_d) < _M or len(_d) > _O:
   _f.append('%s: the criterion is %d-%d characters' % (_n, _M, _O))
  e = _AD(c.get('test', ''))
  if e:
   _f.append('%s (%s): %s' % (_n, _c, e))
  _a = c.get('amount')
  if isinstance(_a, bool) or not isinstance(_a, int) or _a <= 0:
   _f.append('%s: the amount must be a positive integer' % _n)
  else:
   _l += _a
 if not _f and _l != int(value):
  _f.append('the GEN sent (%d) must equal the clause amounts (%d)' % (int(value), _l))
 for _j in _V:
  v = timing.get(_j)
  if isinstance(v, bool) or not isinstance(v, int) or v < _P or (v > _Q):
   _f.append('%s must be %d-%d seconds' % (_j, _P, _Q))
 try:
  if _AA(buyer) == _AA(seller):
   _f.append('the buyer and the seller must differ')
 except _Y as _g:
  _f.append(str(_g))
 return _f

def _AI(clauses):
 _b = [{'id': str(c['id']), 'criterion': str(c['criterion']).strip(), 'test': str(c['test']).strip(), 'amount': int(c['amount'])} for c in clauses]
 return json.dumps(_b, sort_keys=True, separators=(',', ':'))

def _AJ(clauses):
 return hashlib.sha256(_AI(clauses).encode('utf-8')).hexdigest()

def _AK(amount, floor):
 amount = _Z(amount, 'amount')
 floor = _Z(floor, 'floor')
 return max(floor, amount * _T // _U)

def _AL(credits, who, amount):
 if amount > 0:
  credits[who] = credits.get(who, 0) + amount

def _AM(line, ruling, *, now, appeal_seconds):
 if line['state'] != _C:
  raise _Y('clause %r is not disputed' % line['id'])
 if not isinstance(ruling, dict) or str(ruling.get('round', '')) != str(line['dispute']['round']):
  raise _Y('the jury has not ruled on this dispute')
 if ruling.get('verdict') not in _J:
  raise _Y('the ruling has no verdict')
 at = _Z(ruling.get('at'), 'ruled at')
 if at > int(line['dispute']['rule_by']):
  raise _Y('the ruling came after the ruling deadline')
 if int(now) < at + int(appeal_seconds):
  raise _Y('the ruling can be applied from %d, after its appeal window' % (at + int(appeal_seconds)))
 return ruling['verdict']

def apply_ruling(line, *, verdict, buyer, seller, now, redelivery_seconds):
 if line['state'] != _C:
  raise _Y('line %s is not disputed' % line['id'])
 if verdict not in _J:
  raise _Y('unknown verdict %r' % verdict)
 credits = {}
 _a = int(line['dispute']['bond'])
 if verdict == _G:
  line['state'] = _D
  line['redeliver_by'] = int(now) + int(redelivery_seconds)
  _AL(credits, buyer, _a)
 elif verdict == _H:
  line['state'] = _E
  _AL(credits, seller, int(line['amount']) + _a)
 else:
  line['state'] = _E
  _AL(credits, seller, int(line['amount']))
  _AL(credits, buyer, _a)
 line['decided_at'] = int(now)
 return credits

def _AN(deal, now, appeal_seconds=0):
 credits = {}
 _a, _c = (deal['buyer'], deal['seller'])
 now = int(now)
 for _b in deal['lines']:
  _d = _b['state']
  if _d == _A and (not deal.get('delivery')) and (now > int(deal['deliver_by'])):
   _b['state'] = _F
   _AL(credits, _a, int(_b['amount']))
  elif _d == _B and now > int(_b['review_until']):
   _b['state'] = _E
   _AL(credits, _c, int(_b['amount']))
  elif _d == _C and now > int(_b['dispute']['rule_by']) + int(appeal_seconds):
   _b['state'] = _E
   _b['lapsed'] = True
   _AL(credits, _c, int(_b['amount']))
   _AL(credits, _a, int(_b['dispute']['bond']))
  elif _d == _D and now > int(_b['redeliver_by']):
   _b['state'] = _F
   _AL(credits, _a, int(_b['amount']))
  else:
   continue
  _b['decided_at'] = now
 return credits

def _AO(*, deal_id, buyer, seller, clauses, timing, now):
 return {'id': int(deal_id), 'buyer': _AA(buyer, 'buyer'), 'seller': _AA(seller, 'seller'), 'created_at': int(now), 'spec_digest': _AJ(clauses), 'timing': {k: int(timing[k]) for k in _V}, 'deliver_by': int(now) + int(timing['delivery_seconds']), 'delivery': None, 'deliveries': 0, 'lines': [{'id': str(c['id']), 'criterion': str(c['criterion']).strip(), 'test': str(c['test']).strip(), 'amount': int(c['amount']), 'state': _A} for c in clauses]}

def deliver(deal, *, uri, digest, now):
 if not _AB(digest):
  raise _Y('the delivery digest must be 64 hex characters')
 if not str(uri).startswith('https://') and (not str(uri).startswith('http://')):
  raise _Y('the delivery must be an http(s) URL')
 now = int(now)
 _c = int(deal['timing']['review_seconds'])
 if deal.get('delivery') is None:
  if now > int(deal['deliver_by']):
   raise _Y('the delivery deadline has passed')
  _d = [l for l in deal['lines'] if l['state'] == _A]
 else:
  _d = [l for l in deal['lines'] if l['state'] == _D and now <= int(l['redeliver_by'])]
  if not _d:
   raise _Y('nothing to redeliver')
 deal['delivery'] = {'uri': str(uri), 'digest': str(digest).strip().lower(), 'at': now}
 deal['deliveries'] = int(deal.get('deliveries', 0)) + 1
 for _b in _d:
  _b['state'] = _B
  _b['review_until'] = now + _c
  _b.pop('dispute', None)
 return [l['id'] for l in _d]

def _AP(deal, clause_id):
 for _b in deal['lines']:
  if _b['id'] == str(clause_id):
   return _b
 raise _Y('no clause %r in the pinned spec; a dispute must cite one of: %s' % (str(clause_id)[:40], ', '.join((l['id'] for l in deal['lines']))))

def _AQ(deal, *, clause_id, by, text, bond, floor, now, locate=''):
 if _AA(by) != deal['buyer']:
  raise _Y('only the buyer may dispute')
 _b = _AP(deal, clause_id)
 if _b['state'] != _B:
  raise _Y('clause %r is not open for review (it is %s)' % (_b['id'], _b['state']))
 if int(now) > int(_b['review_until']):
  raise _Y('the review window for clause %r has closed' % _b['id'])
 _c = _AK(int(_b['amount']), int(floor))
 if int(bond) < _c:
  raise _Y('the dispute bond for clause %r is %d' % (_b['id'], _c))
 e = _AG(locate)
 if e:
  raise _Y(e)
 _b['state'] = _C
 _b['dispute'] = {'bond': int(bond), 'text': str(text)[:1000], 'opened_at': int(now), 'rule_by': int(now) + int(deal['timing']['ruling_seconds']), 'locate': str(locate), 'round': '%d.%d' % (int(deal.get('deliveries', 0)), int(now))}
 return _b

@gl.evm.contract_interface
class _Payee:

 class View:
  pass

 class Write:
  pass

class Clause(gl.Contract):
 release: str
 jury: str
 appeal_seconds: u256
 bond_floor: u256
 deal_count: u256
 deals: TreeMap[u256, str]
 owed: TreeMap[str, u256]
 owed_total: u256
 held: u256
 refusals: TreeMap[str, str]

 def __init__(self, jury: str, bond_floor: int, appeal_seconds: int):
  if int(bond_floor) <= 0:
   raise Exception('[EXPECTED] the bond floor must be positive')
  if int(appeal_seconds) < 0 or int(appeal_seconds) > _Q:
   raise Exception('[EXPECTED] the appeal window is 0-%d seconds' % _Q)
  self.release = 'clause/2'
  self.jury = _AA(jury, 'jury')
  self.appeal_seconds = u256(int(appeal_seconds))
  self.bond_floor = u256(int(bond_floor))
  self.deal_count = u256(0)
  self.owed_total = u256(0)
  self.held = u256(0)

 def _now(self) -> int:
  return int(datetime.datetime.now().timestamp())

 def _load(self, deal_id: int) -> dict:
  if int(deal_id) < 0 or int(deal_id) >= int(self.deal_count):
   raise Exception('[EXPECTED] unknown deal')
  return json.loads(self.deals[u256(int(deal_id))])

 def _save(self, deal: dict) -> None:
  self.deals[u256(int(deal['id']))] = json.dumps(deal)

 def _pay(self, credits: dict) -> None:
  _c = 0
  for _d, _a in credits.items():
   _b = str(_d).lower()
   self.owed[_b] = u256(int(self.owed.get(_b, u256(0))) + int(_a))
   _c += int(_a)
  self.held = u256(int(self.held) - _c)
  self.owed_total = u256(int(self.owed_total) + _c)

 def _me(self) -> str:
  return str(gl.message.sender_address).lower()

 def _refuse(self, reason: str, value: int) -> None:
  me = self._me()
  if value > 0:
   self.owed[me] = u256(int(self.owed.get(me, u256(0))) + value)
   self.owed_total = u256(int(self.owed_total) + value)
  self.refusals[me] = json.dumps({'reason': str(reason)[:600], 'at': self._now(), 'returned': value})

 @gl.public.write.payable
 def create_deal(self, seller: str, clauses_json: str, delivery_seconds: int, review_seconds: int, redelivery_seconds: int, ruling_seconds: int) -> int:
  _f = int(gl.message.value)
  try:
   _a = json.loads(str(clauses_json))
  except Exception:
   _a = None
  _e = {'delivery_seconds': int(delivery_seconds), 'review_seconds': int(review_seconds), 'redelivery_seconds': int(redelivery_seconds), 'ruling_seconds': int(ruling_seconds)}
  _d = ['the spec is not valid JSON'] if _a is None else _AH(_a, value=_f, timing=_e, buyer=self._me(), seller=str(seller))
  if _d:
   self._refuse('; '.join(_d), _f)
   return -1
  _c = int(self.deal_count)
  _b = _AO(deal_id=_c, buyer=self._me(), seller=str(seller), clauses=_a, timing=_e, now=self._now())
  self._save(_b)
  self.deal_count = u256(_c + 1)
  self.held = u256(int(self.held) + _f)
  return _c

 @gl.public.write
 def deliver(self, deal_id: int, uri: str, digest: str) -> None:
  _a = self._load(deal_id)
  if self._me() != _a['seller']:
   raise Exception('[EXPECTED] only the seller may deliver')
  try:
   deliver(_a, uri=str(uri), digest=str(digest), now=self._now())
  except _Y as _b:
   raise Exception('[EXPECTED] ' + str(_b))
  self._save(_a)

 @gl.public.write.payable
 def dispute(self, deal_id: int, clause_id: str, text: str, locate: str) -> None:
  _a = int(gl.message.value)
  if int(deal_id) < 0 or int(deal_id) >= int(self.deal_count):
   self._refuse('unknown deal', _a)
   return
  _b = json.loads(self.deals[u256(int(deal_id))])
  try:
   _AQ(_b, clause_id=str(clause_id), by=self._me(), text=str(text), bond=_a, floor=int(self.bond_floor), now=self._now(), locate=str(locate))
  except _Y as _c:
   self._refuse(str(_c), _a)
   _d = _b.get('refused', [])
   _d.append({'cited': str(clause_id)[:40], 'reason': str(_c)[:300], 'at': self._now()})
   _b['refused'] = _d[-10:]
   self._save(_b)
   return
  self._save(_b)
  self.held = u256(int(self.held) + _a)

 @gl.public.write
 def apply_ruling(self, deal_id: int, clause_id: str) -> None:
  _a = self._load(deal_id)
  try:
   _c = _AP(_a, str(clause_id))
   _d = gl.get_contract_at(Address(self.jury)).view().ruling_of(str(self.address).lower(), int(deal_id), str(clause_id))
   _e = json.loads(str(_d))
   _f = _AM(_c, _e, now=self._now(), appeal_seconds=int(self.appeal_seconds))
  except _Y as _b:
   raise Exception('[EXPECTED] ' + str(_b))
  credits = apply_ruling(_c, verdict=_f, buyer=_a['buyer'], seller=_a['seller'], now=self._now(), redelivery_seconds=int(_a['timing']['redelivery_seconds']))
  _c['verdict'] = _f
  _c['reason'] = str(_e.get('reason', ''))[:48]
  _c['confidence'] = int(_e.get('confidence', 0))
  _c['artifact'] = str(_e.get('artifact', ''))
  _c['ruled_at'] = int(_e['at'])
  self._save(_a)
  self._pay(credits)

 @gl.public.write
 def settle(self, deal_id: int) -> None:
  _a = self._load(deal_id)
  credits = _AN(_a, self._now(), int(self.appeal_seconds))
  self._save(_a)
  self._pay(credits)

 @gl.public.write
 def withdraw(self) -> None:
  me = self._me()
  _a = int(self.owed.get(me, u256(0)))
  if _a <= 0:
   raise Exception('[EXPECTED] nothing is owed to this address')
  self.owed[me] = u256(0)
  self.owed_total = u256(int(self.owed_total) - _a)
  _Payee(gl.message.sender_address).emit_transfer(value=u256(_a))

 @gl.public.view
 def get_deal(self, deal_id: int) -> str:
  _a = self._load(deal_id)
  _a['now'] = self._now()
  return json.dumps(_a)

 @gl.public.view
 def refusal_of(self, address: str) -> str:
  return self.refusals.get(str(address).lower(), '{}')

 @gl.public.view
 def owed_to(self, address: str) -> int:
  return int(self.owed.get(str(address).lower(), u256(0)))

 @gl.public.view
 def bond_for(self, deal_id: int, clause_id: str) -> int:
  _a = self._load(deal_id)
  return _AK(int(_AP(_a, str(clause_id))['amount']), int(self.bond_floor))

 @gl.public.view
 def status(self) -> str:
  return json.dumps({'release': self.release, 'jury': self.jury, 'appeal_seconds': int(self.appeal_seconds), 'deals': int(self.deal_count), 'held': int(self.held), 'owed': int(self.owed_total), 'balance': int(self.balance), 'bond_floor': int(self.bond_floor)})
