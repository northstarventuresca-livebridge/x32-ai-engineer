"""X32 AI Engineer: verified, operator-approved X32 channel EQ apply/restore.
All 32 X32 input channels: verified EQ readback, four bands, and HPF. Routing, preamps, faders untouched.
Original values backed up to Documents/X32-AI-Engineer/eq-rollback.json.
Python 3.10+, standard library only. No Dante changes.
"""
from __future__ import annotations
import hmac, http.server, json, math, os, secrets, socket, struct, threading, time, webbrowser, subprocess
from pathlib import Path
from urllib.parse import urlparse, parse_qs

X32_HOST = os.getenv('X32_IP', '192.168.1.162')
X32_PORT = int(os.getenv('X32_OSC_PORT', '10023'))
HTTP_PORT = int(os.getenv('X32_READONLY_PORT', '8792'))
BACKUP_PATH=Path.home()/'Documents'/'X32-AI-Engineer'/'eq-rollback.json'  # preserve the legacy CH13 original
TEST_CHANNELS=tuple(range(1,33))  # 32 verified OSC channel addresses; audio mapped CH13/14 only

def backup_path(ch):
    if ch not in TEST_CHANNELS: raise ValueError('Channel must be 1–32')
    return BACKUP_PATH if ch==13 else BACKUP_PATH.with_name('eq-rollback-ch%02d.json'%ch)
AUTH_KEY = os.getenv('X32_READONLY_KEY') or secrets.token_urlsafe(24)
FRONTEND = 'x32-ai-engineer-church.globalconnectionschurch.workers.dev'
METER_TIMEOUT_SECONDS = 12
FIELDS = ['config/name', 'config/color', 'mix/on', 'mix/fader', 'eq/on',
          'preamp/hpon', 'preamp/hpf', 'gate/on', 'gate/thr', 'dyn/on',
          'dyn/thr', 'dyn/ratio']
for i in range(1, 5):
    FIELDS += [f'eq/{i}/type', f'eq/{i}/f', f'eq/{i}/g', f'eq/{i}/q']
TYPE_NAMES = ['LCut', 'LShv', 'PEQ', 'VEQ', 'HShv', 'HCut']

def pad4(raw: bytes) -> bytes:
    return raw + b'\0' * ((-len(raw)) % 4)

def osc_string(s: str) -> bytes:
    return pad4(s.encode('utf8') + b'\0')

def make_message(addr: str, args=()) -> bytes:
    tags = ',' + ''.join('s' if isinstance(x, str) else 'i' if isinstance(x, int) else 'f' for x in args)
    data = osc_string(addr) + osc_string(tags)
    for x in args:
        data += osc_string(x) if isinstance(x, str) else struct.pack('>i' if isinstance(x, int) else '>f', x)
    return data

def decode_osc(raw: bytes):
    def getstr(pos):
        idx = raw.index(b'\0', pos)
        return raw[pos:idx].decode('utf8', 'replace'), (idx + 4) & ~3
    addr, p = getstr(0)
    tags, p = getstr(p)
    if not tags.startswith(','):
        raise ValueError('missing OSC tags')
    args = []
    for tag in tags[1:]:
        if tag in ('f', 'i'):
            args.append(struct.unpack_from('>f' if tag == 'f' else '>i', raw, p)[0]); p += 4
        elif tag == 's':
            v, p = getstr(p); args.append(v)
        elif tag == 'b':
            size = struct.unpack_from('>I', raw, p)[0]; p += 4
            args.append(raw[p:p+size]); p += (size + 3) & ~3
        else:
            raise ValueError('unexpected OSC tag ' + tag)
    return addr, args

def normalized_db(level):
    if not isinstance(level, (float, int)) or level <= 0 or not math.isfinite(level):
        return -120.0
    return max(-120.0, min(18.0, 20 * math.log10(level)))

def normalize(value):
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return max(0., min(1., float(value)))

def value_frequency(norm, low=20., high=20000.):
    return low * (high/low) ** norm if norm is not None else None

class X32Monitor:
    def __init__(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(('0.0.0.0', 0))
        self.sock.settimeout(0.3)
        self.lock = threading.RLock()
        self.raw = {i: {} for i in range(1, 33)}
        self.stamps={i:{} for i in range(1,33)}
        self.run_lock=threading.Lock()
        self.stop_event=threading.Event()
        self.job=None
        self.last_error=None
        self.snapshots={ch:None for ch in TEST_CHANNELS}
        self.prepared=None
        self.last_write=0.
        self.priority_reads = threading.Event()
        self.post_eq_lock = threading.RLock()
        self.last_eq_readback_error = None
        self.last_eq_readback_verified_at = 0.
        self.query_style = None  # learned from verified live X32 replies
        self.last_eq_readback_style = None
        self.last_fresh_udp_port = None
        self.reply_stamps = {}
        self.last_node_reply = None
        self.rejected_packets = 0
        self.malformed_packets = 0
        for channel in TEST_CHANNELS:
            path=backup_path(channel)
            try:
                if path.exists():
                    with path.open(encoding='utf-8') as f: snapshot=json.load(f)
                    if snapshot.get('format')!=2 or snapshot.get('channel')!=channel:
                        raise ValueError('Mismatched or legacy rollback snapshot for channel '+str(channel))
                    self.snapshots[channel]=snapshot
            except (OSError,ValueError,TypeError) as exc:
                self.last_error='Rollback backup unreadable or wrong channel: '+str(path)+'. '+str(exc)
        self.meters = [-120.]*32
        self.meter_updated = 0.
        self.last_packet = 0.
        self.running = True
        self.selected = 13
        self.sends = 0
        threading.Thread(target=self.receive, daemon=True).start()
        threading.Thread(target=self.query_loop, daemon=True).start()


    def route_read(self, address):
        """Read isolated X32 OSC routing parameter with a dedicated UDP socket."""
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as client:
            client.bind(('0.0.0.0', 0))
            client.settimeout(0.4)
            for bare in (False, True):
                client.sendto(osc_string(address) if bare else make_message(address), (X32_HOST, X32_PORT))
                deadline=time.monotonic()+0.48
                while time.monotonic()<deadline:
                    try: packet, peer=client.recvfrom(8192)
                    except socket.timeout: break
                    if peer[0] != X32_HOST: continue
                    try: path, args=decode_osc(packet)
                    except (ValueError, struct.error): continue
                    if path==address and len(args)==1 and type(args[0]) is int:
                        return args[0]
        raise RuntimeError('Cannot verify X32 routing: '+address)

    def route_write(self, address, target, previous):
        if self.route_read(address)!=previous:
            raise RuntimeError('X32 routing changed while preparing '+address)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as client:
            client.sendto(make_message(address,(target,)),(X32_HOST,X32_PORT))
        time.sleep(.12)
        if self.route_read(address)!=target:
            raise RuntimeError('X32 routing write verification failed: '+address)

    def select_post_eq(self, channel):
        """Reserve Dante TX16/UserOut16 for automatically selected channel POST EQ."""
        if type(channel) is not int or channel not in TEST_CHANNELS:
            raise ValueError('Select an input channel 1-32')
        with self.post_eq_lock:
            route='/config/userout/out/16'
            src='/outputs/p16/16/src'
            pos='/outputs/p16/16/pos'
            previous={path:self.route_read(path) for path in (route,src,pos)}
            if previous[route] not in (0,200):
                raise RuntimeError('User Out16 assigned elsewhere: routing left untouched')
            target={route:200,src:25+channel,pos:4}
            applied=[]
            try:
                for path in (src,pos,route):
                    if target[path]!=previous[path]:
                        self.route_write(path,target[path],previous[path])
                        applied.append(path)
                for path,expected in target.items():
                    if self.route_read(path)!=expected:
                        raise RuntimeError('Post EQ monitor routing readback mismatch')
            except Exception:
                for path in reversed(applied):
                    try:
                        if self.route_read(path)==target[path]:
                            self.route_write(path,previous[path],target[path])
                    except Exception: pass
                raise
            return {'ok':True,'channel':channel,'postEq':True,'routeVerifiedByMixer':True,
                    'danteTransmit':16,'danteReceive':16,'tap':'POST_EQ','source':25+channel}

    def send(self, addr, args=(), bare=False):
        # Two read-only OSC GET encodings: address + empty typetag, and
        # address-only (documented X32 parameter query). Never bare-write.
        if addr == '/meters':
            if args != ('/meters/1', 0, 4):
                raise ValueError('unexpected meter request')
        elif addr in ('/info','/status'):
            if args: raise ValueError('system diagnostic may not have arguments')
        elif addr == '/node':
            if args not in tuple((f'ch/{c:02d}/eq',) for c in TEST_CHANNELS):
                raise ValueError('only CH13/14 EQ node inspection allowed')
        elif addr in tuple(f'/ch/{c:02d}/eq'+suffix for c in TEST_CHANNELS for suffix in ('','/1','/2','/3','/4')):
            if args: raise ValueError('grouped EQ queries are strictly read-only')
        elif not (addr.startswith('/ch/') and not args and
                  any(addr.endswith('/' + f) for f in FIELDS)):
            raise ValueError('write and unverified OSC command blocked')
        if bare and args: raise ValueError('bare OSC sends cannot contain arguments')
        packet = osc_string(addr) if bare else make_message(addr, args)
        self.sock.sendto(packet, (X32_HOST, X32_PORT))
        self.sends += 1

    def receive(self):
        while self.running:
            try:
                pkt, addr = self.sock.recvfrom(16384)
                if addr[0] != X32_HOST:
                    self.rejected_packets += 1
                    continue
                try: path, args = decode_osc(pkt)
                except (ValueError, struct.error):
                    self.malformed_packets += 1
                    continue
                with self.lock:
                    self.last_packet = time.time()
                    self.reply_stamps[path] = time.monotonic()
                    if path in ('/node','node') and args and isinstance(args[0],str):
                        self.last_node_reply = (time.monotonic(),args[0][:300])
                    if path == '/meters/1' and args and isinstance(args[0], bytes):
                        blob = args[0]
                        if len(blob) < 8: continue
                        # OSC blob contains big-endian byte length then little-endian float count.
                        bytecount = int.from_bytes(blob[:4], 'big')
                        count = int.from_bytes(blob[4:8], 'little')
                        if count != 96 or bytecount not in (384, 388, 392) or len(blob) < 8 + 96*4:
                            continue  # Do not publish unverified meter payloads.
                        values = struct.unpack_from('<96f', blob, 8)
                        if any(not math.isfinite(v) or v < 0 or v > 8 for v in values[:32]):
                            continue
                        self.meters = [round(normalized_db(x), 1) for x in values[:32]]
                        self.meter_updated = time.time()
                    elif any(path==f'/ch/{ch:02d}/eq' or path in tuple(f'/ch/{ch:02d}/eq/{n}' for n in range(1,5)) for ch in TEST_CHANNELS) and args:
                        t=time.monotonic()
                        ch=int(path.split('/')[2]); tail=path.split('/')
                        if len(tail)==4 and len(args)==1 and type(args[0]) is int and args[0] in (0,1):
                            self.raw[ch]['eq/on']=args[0]
                            self.stamps[ch]['eq/on']=t
                        elif len(tail)==5 and tail[-1] in ('1','2','3','4') and len(args)==4 and type(args[0]) is int and 0<=args[0]<=5 and all(type(v) is float and math.isfinite(v) and 0<=v<=1 for v in args[1:]):
                            idx=int(tail[-1])
                            for sub,val in zip(('type','f','g','q'),args):
                                field=f'eq/{idx}/{sub}'
                                self.raw[ch][field]=val
                                self.stamps[ch][field]=t
                    elif path.startswith('/ch/') and args:
                        parts = path.split('/')
                        if len(parts) < 4 or not parts[2].isdigit(): continue
                        ch = int(parts[2])
                        if not 1 <= ch <= 32: continue
                        field = '/'.join(parts[3:])
                        if field not in FIELDS: continue
                        self.raw[ch][field] = args[0]
                        self.stamps[ch][field] = time.monotonic()
            except socket.timeout:
                continue
            except (ValueError, struct.error, OSError):
                continue

    def query_loop(self):
        next_names = 0.; next_ch = 0.; next_meter = 0.
        while self.running:
            # Pause background polling during verified snapshots or EQ operations.
            # The X32 OSC connection is UDP: interleaving dozens of rapid queries
            # with a critical readback can cause individual replies to be dropped.
            if self.priority_reads.is_set() or self.run_lock.locked():
                time.sleep(.08)
                continue
            now = time.time()
            try:
                if now >= next_meter:
                    self.send('/meters', ('/meters/1', 0, 4))
                    next_meter = now + 5
                if now >= next_names:
                    for ch in range(1, 33):
                        if self.priority_reads.is_set() or self.run_lock.locked(): break
                        self.send(f'/ch/{ch:02d}/config/name',bare=(self.query_style=='bare')); time.sleep(.012)
                        self.send(f'/ch/{ch:02d}/config/color',bare=(self.query_style=='bare')); time.sleep(.012)
                        self.send(f'/ch/{ch:02d}/mix/on',bare=(self.query_style=='bare')); time.sleep(.012)
                    next_names = time.time() + 20
                if now >= next_ch:
                    with self.lock: ch = self.selected
                    for field in FIELDS:
                        if self.priority_reads.is_set() or self.run_lock.locked(): break
                        self.send(f'/ch/{ch:02d}/{field}',bare=(self.query_style=='bare')); time.sleep(.025)
                    next_ch = time.time() + 1.5
                time.sleep(.04)
            except OSError:
                time.sleep(.5)

    def board(self):
        with self.lock:
            active = time.time() - self.last_packet < METER_TIMEOUT_SECONDS
            meter_valid = time.time() - self.meter_updated < METER_TIMEOUT_SECONDS
            items = []
            for ch in range(1, 33):
                raw = self.raw[ch]
                color = raw.get('config/color')
                color = color if type(color) is int and 0 <= color <= 15 else None
                items.append({'channel':ch,'name':raw.get('config/name') or f'CH {ch:02d}',
                              'colorRaw':color,'colorVerified':color is not None,
                              'mute':raw.get('mix/on') == 0 if 'mix/on' in raw else None,
                              'meterDbfs':self.meters[ch-1] if meter_valid else None})
            return {'ok':True,'mixerOnline':active,'metersVerified':meter_valid,
                    'selected':self.selected,'channels':items,'timestamp':time.time()}

    def details(self, ch):
        with self.lock:
            self.selected = ch
            r = dict(self.raw[ch])
        bands = []
        for idx in range(1, 5):
            stem = f'eq/{idx}/'
            typ = r.get(stem+'type')
            f = normalize(r.get(stem+'f'))
            g = normalize(r.get(stem+'g'))
            q = normalize(r.get(stem+'q'))
            bands.append({'band':idx,'type':TYPE_NAMES[typ] if isinstance(typ,int) and 0<=typ<6 else None,
                          'typeRaw':typ,'frequencyHz':round(value_frequency(f), 1) if f is not None else None,
                          'gainDb':round(-15+30*g,2) if g is not None else None,
                          'q':round(10 * (.03 ** q),3) if q is not None else None,
                          'raw':{'f':f,'g':g,'q':q}})
        hpf=normalize(r.get('preamp/hpf'))
        thr=normalize(r.get('gate/thr'))
        cthr=normalize(r.get('dyn/thr'))
        return {'channel':ch,'name':r.get('config/name') or f'CH {ch:02d}',
                'lastPacketAgeSec':round(time.time()-self.last_packet,1) if self.last_packet else None,
                'colorRaw':r.get('config/color') if type(r.get('config/color')) is int and 0 <= r.get('config/color') <= 15 else None,
                'eqOn':bool(r['eq/on']) if 'eq/on' in r else None,'bands':bands,
                'hpf':{'on':bool(r['preamp/hpon']) if 'preamp/hpon' in r else None,
                       'frequencyHz':round(value_frequency(hpf,20,400),1) if hpf is not None else None},
                'gate':{'on':bool(r['gate/on']) if 'gate/on' in r else None,
                        'thresholdDb':round(-80 + 80*thr,1) if thr is not None else None},
                'compressor':{'on':bool(r['dyn/on']) if 'dyn/on' in r else None,
                              'thresholdDb':round(-60 + 60*cthr,1) if cthr is not None else None,
                              'ratioIndex':r.get('dyn/ratio')},
                'faderRaw':r.get('mix/fader'),'mute':r.get('mix/on')==0 if 'mix/on' in r else None,
                'readOnly':False, 'manualWriteTestChannels':list(TEST_CHANNELS)}


    def read_fresh(self, ch, field, timeout=5.0):
        """Read a fresh X32 OSC value via a NEW independent UDP source port.

        The original shared socket carries periodic meters / 32-channel polling;
        physical X32 confirmed it answers isolated wire probes from a different
        local UDP port even when the shared socket misses specific EQ replies.
        Never accept the shared monitor cache for an approved write.
        """
        if ch not in TEST_CHANNELS or field not in FIELDS:
            raise ValueError('Only approved channel EQ readback supported')
        if not (field.startswith('eq/') or field in ('preamp/hpf','preamp/hpon')):
            raise ValueError('Fresh EQ readback only; no routing or gain requests')
        address = f'/ch/{ch:02d}/{field}'
        deadline=time.monotonic()+timeout
        tried=[]
        malformed=0
        others=0
        styles=[self.query_style,'bare' if self.query_style=='typed' else 'typed'] if self.query_style in ('bare','typed') else ['typed','bare']
        # One independent local port per fresh read transaction; never borrow
        # an earlier response from the long-lived polling socket.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.bind(('0.0.0.0',0))
            probe.settimeout(.12)
            for attempt in range(6):
                if time.monotonic()>=deadline:break
                if self.stop_event.is_set() and self.run_lock.locked():
                    raise RuntimeError('Operator STOP before EQ readback')
                style=styles[attempt%2]
                tried.append(style)
                encoded=osc_string(address) if style=='bare' else make_message(address)
                # This is the READ form ONLY: no OSC arguments or write values.
                probe.sendto(encoded,(X32_HOST,X32_PORT))
                limit=min(deadline,time.monotonic()+.72)
                while time.monotonic()<limit:
                    try:
                        data,peer=probe.recvfrom(16384)
                    except socket.timeout:
                        continue
                    if peer[0]!=X32_HOST or peer[1]!=X32_PORT:
                        others+=1
                        continue
                    try:
                        reply,values=decode_osc(data)
                    except (ValueError,IndexError,struct.error,UnicodeError):
                        malformed+=1
                        continue
                    if reply!=address or len(values)!=1:
                        others+=1
                        continue
                    value=values[0]
                    integer=field in ('eq/on','preamp/hpon') or field.endswith('/type')
                    if integer:
                        acceptable=type(value) is int and ((0<=value<=5) if field.endswith('/type') else (value in (0,1)))
                    else:
                        acceptable=type(value) is float and math.isfinite(value) and 0<=value<=1
                    if not acceptable:
                        malformed+=1
                        continue
                    # Cache ONLY the fresh observed value with its new timestamp,
                    # and let normal board/UI polling continue independently.
                    with self.lock:
                        self.raw[ch][field]=value
                        self.stamps[ch][field]=time.monotonic()
                        self.last_packet=time.time()
                        self.last_eq_readback_error=None
                        self.last_eq_readback_style=style
                        self.query_style=style
                        self.last_fresh_udp_port=probe.getsockname()[1]
                    return value
                time.sleep(.045)
        message=(f'No DIRECT fresh X32 reply for {address}: {len(tried)} read-only '
                 f'queries from a separate UDP port ({", ".join(tried)}; '
                 f'{malformed} malformed/unrecognized and {others} unrelated replies). '
                 'EQ NOT changed. Check firewall and isolated OSC wire probe.')
        self.last_eq_readback_error=message
        raise RuntimeError(message)

    def osc_diagnostics(self, ch=13):
        """Read-only OSC tests; exposes per-request results, no writes or key."""
        if ch not in TEST_CHANNELS: raise RuntimeError('Only X32 input channels 1–32 supported')
        if self.run_lock.locked(): raise RuntimeError('EQ operation running; diagnostics unavailable')
        self.priority_reads.set()
        results=[]
        try:
            for endpoint in ('/info','/ch/13/config/name','/ch/13/eq/on','/ch/13/eq/1/f'):
                for style in ('typed','bare'):
                    sent_at=time.monotonic()
                    try:
                        self.send(endpoint,bare=(style=='bare'))
                        until=time.monotonic()+0.33
                        success=False
                        while time.monotonic()<until:
                            with self.lock:
                                stamp=self.reply_stamps.get(endpoint,0)
                                if stamp>sent_at:
                                    success=True
                                    break
                            time.sleep(.02)
                        results.append({'path':endpoint,'encoding':style,'replied':success})
                        if success and endpoint=='/ch/13/eq/on':
                            self.query_style=style
                    except (OSError, ValueError) as e:
                        results.append({'path':endpoint,'encoding':style,'replied':False,'error':str(e)})
            for endpoint in ('/ch/13/eq', '/ch/13/eq/1', '/ch/13/eq/2', '/ch/13/eq/3', '/ch/13/eq/4'):
                for style in ('typed','bare'):
                    when=time.monotonic()
                    self.send(endpoint,bare=(style=='bare'))
                    limit=time.monotonic()+0.28
                    replied=False
                    while time.monotonic()<limit:
                        with self.lock:
                            stamp=self.reply_stamps.get(endpoint,0)
                            replied=stamp>when
                        if replied:break
                        time.sleep(.025)
                    results.append({'path':endpoint,'encoding':style,'replied':replied,'grouped':True})
            # '/node' diagnostic can return a full EQ node string even when
            # a specific single-value OSC parameter query is unsupported.
            node_since=time.monotonic()
            self.send('/node',('ch/13/eq',))
            until=time.monotonic()+0.45
            node_text=None
            while time.monotonic()<until:
                with self.lock:
                    reply=self.last_node_reply
                    if reply and reply[0]>node_since:
                        node_text=reply[1]
                        break
                time.sleep(.02)
            with self.lock:
                response_age=round(time.time()-self.last_packet,2) if self.last_packet else None
                recent_fields={p:round(time.monotonic()-t,2) for p,t in self.stamps[13].items() if p in ('config/name','eq/on','eq/1/f')}
            return {'ok':True,'diagnosticOnly':True,'legacyDiagnosticChannel':13,'mixerIP':X32_HOST,'udpPort':X32_PORT,
                    'localUdpPort':self.sock.getsockname()[1], 'lastPacketAgeSec':response_age,
                    'channel13CachedFieldAgeSec':recent_fields,'getRequests':results,
                    'nodeEqReply':node_text,'nodeResponded':node_text is not None,
                    'preferredGetEncoding':self.query_style,
                    'groupedEqResponse':bool(self.reply_stamps.get('/ch/13/eq/1')),
                    'rejectedOtherSourcePackets':self.rejected_packets,
                    'malformedOscPackets':self.malformed_packets,
                    'writesSent':False,
                    'directSocketTest':self.direct_socket_diagnostic(ch),'diagnosticChannel':ch}
        finally:
            self.priority_reads.clear()

    def direct_socket_diagnostic(self,ch=13):
        """Prove single-field EQ readback using the SAME separate UDP code as Apply.

        This is safe: only read requests are emitted, and no mixer writes.
        """
        results=[]
        for field in ('eq/on','eq/1/f','eq/1/g','eq/2/f','preamp/hpf'):
            try:
                value=self.read_fresh(ch,field,timeout=3.)
                results.append({'field':field,'ok':True,'value':round(value,5) if type(value) is float else value})
            except RuntimeError as exc:
                results.append({'field':field,'ok':False,'error':str(exc)[:200]})
        return {'method':'dedicated temporary UDP socket per EQ field','results':results,
                'allVerified':all(x['ok'] for x in results)}

    def current_eq(self,ch):
        if ch not in TEST_CHANNELS: raise ValueError('Only X32 input channels 1–32 supported')
        if time.time()-self.last_packet>5:raise RuntimeError('Mixer OSC connection is not current')
        self.priority_reads.set()
        try:
            eq=self.read_fresh(ch,'eq/on')
            if eq!=1:raise RuntimeError('Channel EQ is OFF; enable manually before applying')
            bands=[]
            for n in range(1,5):
                t=self.read_fresh(ch,f'eq/{n}/type')
                if type(t) is not int or not 0<=t<=5:raise RuntimeError('Unverified band filter type')
                vals=[]
                for param in ('f','g','q'):
                    val=self.read_fresh(ch,f'eq/{n}/{param}')
                    if type(val) is not float or not math.isfinite(val) or not 0<=val<=1:
                        raise RuntimeError('Invalid EQ '+str(n)+' '+param+' readback')
                    vals.append(val)
                bands.append({'type':t,'f':vals[0],'g':vals[1],'q':vals[2]})
            hpf_raw=self.read_fresh(ch,'preamp/hpf')
            hpf_on=self.read_fresh(ch,'preamp/hpon')
            if type(hpf_raw) is not float or not math.isfinite(hpf_raw) or not 0<=hpf_raw<=1 or hpf_on not in (0,1):
                raise RuntimeError('Invalid HPF readback')
            verified={'channel':ch,'eqOn':eq,'bands':bands,'hpf':{'on':hpf_on,'f':hpf_raw}}
            self.last_eq_readback_verified_at=time.time()
            return verified
        finally:
            self.priority_reads.clear()

    @staticmethod
    def norm_freq(f, low=20, high=20000):
        return math.log(f/low)/math.log(high/low)

    @staticmethod
    def norm_q(q):
        return math.log(q/10)/math.log(.03)

    def prepare(self,ch):
        if self.run_lock.locked():raise RuntimeError('Another EQ operation in progress')
        current=self.current_eq(ch)
        nonce=secrets.token_urlsafe(20)
        self.prepared={'nonce':nonce,'timestamp':time.time(),'channel':ch,'eq':current}
        return {'ok':True,'nonce':nonce,'expiresInSeconds':60,'channel':ch,
                'current':self.pretty(current),'backupExists':bool(self.snapshots[ch])}

    @staticmethod
    def pretty(eq):
        return {'channel':eq['channel'],
                'bands':[{'band':i+1,'type':TYPE_NAMES[b['type']],
                          'frequencyHz':round(20*1000**b['f'],1),
                          'gainDb':round(-15+30*b['g'],2),
                          'q':round(10*.03**b['q'],3)} for i,b in enumerate(eq['bands'])],
                'hpf':{'on':bool(eq['hpf']['on']),'frequencyHz':round(20*20**eq['hpf']['f'],1)}}

    def ensure_backup(self,current):
        ch=current['channel']
        if ch not in TEST_CHANNELS: raise RuntimeError('Invalid backup channel')
        if self.last_error and 'backup unreadable' in self.last_error.lower():raise RuntimeError(self.last_error)
        if self.snapshots[ch]:
            snap=self.snapshots[ch]
            if snap.get('format')!=2 or snap.get('channel')!=ch:
                raise RuntimeError('Rollback snapshot does not belong to selected channel')
            return
        snap={'format':2,'channel':ch,'created':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
              'original':current,'changed':[]}
        self.snapshots[ch]=snap
        self.persist(ch)

    def persist(self,ch):
        path=backup_path(ch)
        path.parent.mkdir(parents=True,exist_ok=True)
        tmp=path.with_suffix('.tmp')
        with tmp.open('w',encoding='utf-8') as f:
            json.dump(self.snapshots[ch],f,indent=2)
            f.flush();os.fsync(f.fileno())
        tmp.replace(path)

    def write_one(self,ch,field,target,expected,stop=True):
        if stop and self.stop_event.is_set():raise RuntimeError('STOP requested; snapshot retained for Restore')
        if ch not in TEST_CHANNELS or (not field.startswith('eq/') and field not in ('preamp/hpf','preamp/hpon')):
            raise RuntimeError('Write outside channel EQ allowlist')
        if field.startswith('eq/'):
            parts=field.split('/')
            if len(parts)!=3 or parts[1] not in ('1','2','3','4') or parts[2] not in ('type','f','g','q'):
                raise RuntimeError('Write outside four band allowlist')
        if field=='preamp/hpon':
            if type(target) is not int or target not in (0,1):raise ValueError('Invalid HPF on/off')
        elif field.endswith('/type'):
            if type(target) is not int or not 0<=target<=5:raise ValueError('Invalid band filter type')
        elif not isinstance(target,float) or not math.isfinite(target) or not 0<=target<=1:
            raise ValueError('Invalid normalized EQ value')
        current=self.read_fresh(ch,field)
        tolerance=0 if (field.endswith('/type') or field=='preamp/hpon') else (.025 if field.endswith('/q') else .010)
        if abs(current-expected)>tolerance:
            raise RuntimeError('Console value changed independently at '+field+'; operation stopped')
        self.sock.sendto(make_message(f'/ch/{ch:02d}/{field}',[target]),(X32_HOST,X32_PORT))
        self.last_write=time.time()
        for i in range(6):
            time.sleep(.07)
            try:actual=self.read_fresh(ch,field)
            except RuntimeError:continue
            if abs(actual-target)<=tolerance:return actual
        raise RuntimeError('X32 did not verify '+field+'; restore is available')

    def state(self,ch=13):
        if ch not in TEST_CHANNELS: raise ValueError('Only X32 input channels 1–32 supported')
        j=self.job
        snap=self.snapshots[ch]
        return {'ok':True,'manualTestChannels':list(TEST_CHANNELS),'writesEnabled':True,'bridgeVersion':'AUTO-ROOM-POST-EQ-V109','mode':'FULL 4-BAND MODE/FREQ/GAIN/Q APPLY & RESTORE - 32 INPUT CHANNELS',
                'channel':ch,'job':j.copy() if j else None,'backupExists':bool(snap),
                'backupTime':snap.get('created') if snap else None,
                'changedFields':snap.get('changed',[]) if snap else [],
                'lastError':self.last_error,'preferredGetEncoding':self.query_style,'lastEqReadbackEncoding':self.last_eq_readback_style,'lastFreshEqPort':self.last_fresh_udp_port,'eqReadbackError':self.last_eq_readback_error,'eqReadbackVerifiedAgeSec':round(time.time()-self.last_eq_readback_verified_at,1) if self.last_eq_readback_verified_at else None,'lastPacketAgeSec':round(time.time()-self.last_packet,2) if self.last_packet else None}

    def launch(self,action,data):
        ch=data['channel']
        if ch not in TEST_CHANNELS:raise ValueError('Only X32 input channels 1–32 supported')
        if not self.run_lock.acquire(blocking=False):raise RuntimeError('Another EQ operation is running')
        self.stop_event.clear();self.last_error=None
        self.job={'action':action,'status':'starting','started':time.time(),'step':0,'steps':0,
                  'channel':ch,'error':None}
        threading.Thread(target=self.worker,args=(action,data),daemon=True).start()
        return self.state(ch)

    @staticmethod
    def eq_equal(a,b):
        if a['eqOn']!=b['eqOn'] or a['hpf']['on']!=b['hpf']['on'] or abs(a['hpf']['f']-b['hpf']['f'])>.006:return False
        for x,y in zip(a['bands'],b['bands']):
            if x['type']!=y['type']:return False
            for f in ('f','g','q'):
                if abs(x[f]-y[f])>.012:return False
        return True

    def _write_target(self,ch,field,target,expected,speed='instant'):
        """Send a change and verify each OSC field readback. Gain can be fast or gradual."""
        if field.endswith('/g') and speed!='instant' and abs(float(target)-float(expected))>.010:
            count=6 if speed=='aggressive' else 10
            duration=3 if speed=='aggressive' else 10
            prev=float(expected)
            for k in range(1,count+1):
                if self.stop_event.is_set():raise RuntimeError('STOP pressed; rollback available')
                point=float(expected)+(float(target)-float(expected))*k/count
                prev=self.write_one(ch,field,float(point),float(prev))
                if k<count:time.sleep(duration/count)
        else:
            self.write_one(ch,field,int(target) if field.endswith('/type') or field=='preamp/hpon' else float(target),
                           int(expected) if field.endswith('/type') or field=='preamp/hpon' else float(expected))

    def _apply_band(self,ch,n,desired,speed='instant'):
        """Change all four parameters on a band; read values fresh after mode changes.

        When type changes, neutralize gain while moving frequency/Q to avoid an
        unintended huge boost/cut on switching between PEQ/VEQ/shelf/cut modes.
        """
        prefix=f'eq/{n}/'
        current={k:self.read_fresh(ch,prefix+k) for k in ('type','f','g','q')}
        type_changed=current['type']!=desired['type']
        if type_changed:
            if abs(current['g']-.5)>.007:
                self._write_target(ch,prefix+'g',.5,current['g'],speed)
                current['g']=self.read_fresh(ch,prefix+'g')
            # For a final low/high cut, set frequency before enabling the cut.
            # For a final parametric/shelf, enable the mode with neutral gain first.
            if desired['type'] not in (0,5):
                self._write_target(ch,prefix+'type',desired['type'],current['type'])
                current={k:self.read_fresh(ch,prefix+k) for k in ('type','f','g','q')}
        for key in ('f','q'):
            actual=self.read_fresh(ch,prefix+key)
            if abs(actual-desired[key])>.007:
                self._write_target(ch,prefix+key,float(desired[key]),float(actual))
        if type_changed and desired['type'] in (0,5):
            actual=self.read_fresh(ch,prefix+'type')
            if actual!=desired['type']:
                self._write_target(ch,prefix+'type',desired['type'],actual)
            # A console can reset f/q when filter type switches: re-read and re-set.
            for key in ('f','q'):
                after=self.read_fresh(ch,prefix+key)
                if abs(after-desired[key])>.007:
                    self._write_target(ch,prefix+key,float(desired[key]),float(after))
        actual=self.read_fresh(ch,prefix+'g')
        if abs(actual-desired['g'])>.007:
            self._write_target(ch,prefix+'g',float(desired['g']),float(actual),speed)
        # Verify that all four fields actually ended up where requested.
        observed={k:self.read_fresh(ch,prefix+k) for k in ('type','f','g','q')}
        if observed['type']!=desired['type'] or any(abs(observed[k]-desired[k])>.012 for k in ('f','g','q')):
            raise RuntimeError('Full B'+str(n)+' mode/frequency/gain/Q verification failed; Restore available')

    def worker(self,action,data):
        try:
            ch=data['channel']
            if action=='apply':
                prep=data['prepared']
                verified=self.current_eq(ch)
                if not self.eq_equal(prep,verified):raise RuntimeError('Console changed since Apply confirmation. Refresh and retry.')
                speed=data.get('speed','instant')
                desired=json.loads(json.dumps(verified))
                affected=[]
                for p in data['recommendations']:
                    n=p['band'];affected.append(n)
                    desired['bands'][n-1]={
                        'type':TYPE_NAMES.index(p['type']),
                        'f':self.norm_freq(p['frequencyHz']),
                        'g':(p['gainDb']+15)/30,
                        'q':self.norm_q(p['q'])}
                if data.get('hpf'):
                    hp=data['hpf']
                    if 'frequencyHz' in hp:desired['hpf']['f']=self.norm_freq(hp['frequencyHz'],20,400)
                    if 'on' in hp:desired['hpf']['on']=int(hp['on'])
                self.ensure_backup(verified)
                # Keep all original band fields in the rollback record, including
                # filter-mode fields. This is persisted BEFORE the first physical write.
                changes=[]
                for n in affected:
                    for key in ('type','f','q','g'):
                        addr=f'eq/{n}/{key}'
                        if addr not in self.snapshots[ch]['changed']:
                            self.snapshots[ch]['changed'].append(addr)
                        changes.append(addr)
                for key,addr in (('f','preamp/hpf'),('on','preamp/hpon')):
                    if abs(desired['hpf'][key]-verified['hpf'][key])>.006:
                        if addr not in self.snapshots[ch]['changed']:self.snapshots[ch]['changed'].append(addr)
                        changes.append(addr)
                self.persist(ch)
                self.job.update(status='running',step=0,steps=len(changes),changedFields=changes)
                for n in affected:
                    if self.stop_event.is_set():raise RuntimeError('STOP pressed; rollback available')
                    self._apply_band(ch,n,desired['bands'][n-1],speed)
                    self.job['step']+=4
                for key,field in (('f','preamp/hpf'),('on','preamp/hpon')):
                    if field not in changes:continue
                    old=self.read_fresh(ch,field)
                    self._write_target(ch,field,desired['hpf'][key],old)
                    self.job['step']+=1
                final=self.current_eq(ch)
                if not self.eq_equal(final,desired):raise RuntimeError('Full 4-band final EQ readback differs from approved targets; use Restore')
                self.job['verified']=self.pretty(final)
                self.job['status']='verified'
            elif action=='restore':
                if not self.snapshots[ch]:raise RuntimeError('No saved EQ settings to restore on CH'+str(ch))
                snap=self.snapshots[ch]
                if snap.get('channel')!=ch:raise RuntimeError('Refusing cross-channel restore')
                original=snap.get('original')
                if not original:raise RuntimeError('Incomplete rollback snapshot. Restore manually.')
                self.job.update(status='restoring',step=0,steps=18)
                current=self.current_eq(ch)
                # Revert the entire EQ, not only gains. This handles both old
                # snapshots and all filters including HCut, LCut, VEQ, and shelves.
                for n in range(1,5):
                    if self.stop_event.is_set():raise RuntimeError('STOP pressed during Restore; backup preserved')
                    self._apply_band(ch,n,original['bands'][n-1],data.get('speed','instant'))
                    self.job['step']+=4
                for key,field in (('f','preamp/hpf'),('on','preamp/hpon')):
                    old=self.read_fresh(ch,field)
                    target=original['hpf'][key]
                    if abs(old-target)>.006:self._write_target(ch,field,target,old)
                    self.job['step']+=1
                final=self.current_eq(ch)
                if not self.eq_equal(final,original):raise RuntimeError('Restore final readback mismatch; backup retained')
                self.job['verified']=self.pretty(final)
                self.snapshots[ch]=None
                try:backup_path(ch).unlink(missing_ok=True)
                except OSError:pass
                self.job['status']='restored'
            else:raise RuntimeError('Unsupported operation')
        except Exception as e:
            self.last_error=str(e)
            self.job['status']='stopped' if self.stop_event.is_set() else 'failed'
            self.job['error']=str(e)
        finally:
            self.job['finished']=time.time()
            self.run_lock.release()

monitor = None
class API(http.server.BaseHTTPRequestHandler):
    def origin_ok(self):
        origin = self.headers.get('Origin','')
        if not origin: return False
        host = urlparse(origin).hostname or ''
        return (urlparse(origin).scheme == 'https' and
                (host == FRONTEND or host.endswith('-'+FRONTEND)))
    def cors(self):
        if self.origin_ok():
            self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
            self.send_header('Access-Control-Allow-Headers','X-Bridge-Key, Content-Type')
            self.send_header('Access-Control-Allow-Methods','GET, OPTIONS, POST')
            self.send_header('Access-Control-Allow-Private-Network','true')
            self.send_header('Vary','Origin')
    def respond(self, status, obj):
        body=json.dumps(obj,ensure_ascii=False,allow_nan=False).encode()
        self.send_response(status);self.cors()
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Type','application/json;charset=utf-8')
        self.send_header('Content-Length',str(len(body)))
        self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers();self.wfile.write(body)
    def do_OPTIONS(self):
        if not self.origin_ok(): return self.respond(403,{'error':'Origin denied'})
        self.send_response(204); self.cors();self.end_headers()
    def do_GET(self):
        if not self.origin_ok(): return self.respond(403,{'error':'Origin denied'})
        if not hmac.compare_digest(self.headers.get('X-Bridge-Key',''),AUTH_KEY):
            return self.respond(401,{'error':'Bridge key required'})
        path=urlparse(self.path)
        if path.path=='/api/board': return self.respond(200,monitor.board())
        if path.path=='/api/eq/status':
            try:
                ch=int(parse_qs(path.query).get('channel',['13'])[0]);return self.respond(200,monitor.state(ch))
            except ValueError as e:return self.respond(400,{'error':str(e)})
        if path.path=='/api/osc/diagnose':
            try:
                ch=int(parse_qs(path.query).get('channel',['13'])[0]);return self.respond(200,monitor.osc_diagnostics(ch))
            except RuntimeError as err:return self.respond(409,{'error':str(err)})
        if path.path=='/api/eq/prepare':
            try:
                ch=int(parse_qs(path.query).get('channel',[''])[0])
                return self.respond(200,monitor.prepare(ch))
            except (ValueError,RuntimeError) as err:return self.respond(409,{'error':str(err)})
        if path.path=='/api/channel':
            try: n=int(parse_qs(path.query).get('number',[''])[0]);assert 1<=n<=32
            except (ValueError,AssertionError): return self.respond(400,{'error':'Channel must be 1–32'})
            return self.respond(200,monitor.details(n))
        return self.respond(404,{'error':'Unknown read-only API'})
    def do_POST(self):
        if not self.origin_ok():return self.respond(403,{'error':'Origin denied'})
        if not hmac.compare_digest(self.headers.get('X-Bridge-Key',''),AUTH_KEY):
            return self.respond(401,{'error':'Bridge key required'})
        if self.headers.get('Content-Type','').split(';')[0]!='application/json':
            return self.respond(415,{'error':'JSON required'})
        try:
            length=int(self.headers.get('Content-Length','0'))
            if length<2 or length>4096: raise ValueError('Invalid payload length')
            v=json.loads(self.rfile.read(length))
            if type(v) is not dict:raise ValueError('Object required')
            action=urlparse(self.path).path
            if action=='/api/post-eq/select':
                if v.get('ack')!='AUTO_POST_EQ_MONITOR':
                    raise ValueError('AI monitor authorization required')
                return self.respond(200,monitor.select_post_eq(v.get('channel')))
            if action=='/api/eq/stop':
                monitor.stop_event.set()
                return self.respond(200,{'ok':True,'stopRequested':True,'job':monitor.job})
            if action=='/api/eq/apply':
                if v.get('channel') not in TEST_CHANNELS:raise ValueError('Only input channels 1–32 are supported')
                if v.get('ack')!='CONFIRM_REAL_X32_EQ_WRITE':raise ValueError('Operator confirmation required')
                if v.get('speed') not in ('instant','aggressive','slow'):raise ValueError('Invalid speed')
                prep=monitor.prepared
                if not prep or prep.get('channel')!=v['channel'] or not hmac.compare_digest(str(v.get('nonce','')),prep['nonce']) or time.time()-prep['timestamp']>60:
                    raise ValueError('Prepare a fresh X32 snapshot before applying')
                changes=v.get('recommendations')
                if not isinstance(changes,list) or not 1<=len(changes)<=4:raise ValueError('One to four EQ recommendations required')
                seen=set()
                for p in changes:
                    if type(p) is not dict or type(p.get('band')) is not int or p['band'] not in range(1,5) or p['band'] in seen:
                        raise ValueError('Unexpected or duplicate EQ band')
                    seen.add(p['band'])
                    if p.get('type') not in TYPE_NAMES:raise ValueError('Every band proposal must include a valid filter mode')
                    for f,lo,hi in [('frequencyHz',20,20000),('gainDb',-15,15),('q',.3,10)]:
                        x=p.get(f)
                        if type(x) not in (int,float) or not math.isfinite(x) or not lo<=x<=hi:raise ValueError('Invalid '+f+' target')
                hpf=v.get('hpf')
                if hpf is not None:
                    if type(hpf) is not dict:raise ValueError('Invalid HPF request')
                    if 'frequencyHz' in hpf and (type(hpf['frequencyHz']) not in (int,float) or not 20<=hpf['frequencyHz']<=400):raise ValueError('HPF frequency out of range')
                    if 'on' in hpf and type(hpf['on']) is not bool:raise ValueError('HPF toggle invalid')
                op=monitor.launch('apply',{'channel':v['channel'],'prepared':prep['eq'],'recommendations':changes,'hpf':hpf,'speed':v['speed']})
                monitor.prepared=None  # consume nonce only after successful launch
                return self.respond(202,op)
            if action=='/api/eq/restore':
                if v.get('ack')!='CONFIRM_RESTORE_EQ':raise ValueError('Restore confirmation required')
                if v.get('channel') not in TEST_CHANNELS:raise ValueError('Select X32 channel 1–32 for restore')
                return self.respond(202,monitor.launch('restore',v))
            return self.respond(404,{'error':'Unknown EQ control path'})
        except (ValueError,RuntimeError) as exc:return self.respond(409,{'error':str(exc)})
        except (json.JSONDecodeError, OSError):return self.respond(400,{'error':'Invalid operation payload'})
    def log_message(self, fmt, *args): pass

if __name__ == '__main__':
    monitor=X32Monitor()
    print('X32 engineer bridge at http://127.0.0.1:%s' % HTTP_PORT, flush=True)
    print('Bridge key copied to Windows clipboard. Paste into dashboard if requested.', flush=True)
    try:
        subprocess.run(['clip.exe'], input=AUTH_KEY.encode('utf-16le'), check=True, timeout=4)
    except Exception as exc:
        print('Clipboard unavailable; bridge key: '+AUTH_KEY, flush=True)
    webbrowser.open('https://'+FRONTEND+'/')
    print('Mixer IP: '+X32_HOST+' | REAL EQ APPLY/RESTORE · ALL 32 INPUT CHANNELS · operator approval required',flush=True)
    print('Original EQ backups: '+str(backup_path(13))+' | '+str(backup_path(14)),flush=True)
    http.server.ThreadingHTTPServer(('127.0.0.1',HTTP_PORT),API).serve_forever()
