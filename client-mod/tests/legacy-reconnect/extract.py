#!/usr/bin/env python3
"""Copy exact production method text, without algorithm rewrites, into a fake-game fixture."""
import hashlib
from pathlib import Path
import re
import sys

source = Path(sys.argv[1]).read_text()
template = Path(sys.argv[2]).read_text()

def method(name, required=True):
    matches = list(re.finditer(r'^    private [^\n]*\b' + re.escape(name) + r'\([^\n]*\)\s*\{', source, re.M))
    if not matches and not required:
        return f'// Production snapshot has no {name}; reconnectClient remains copied exactly.'
    if len(matches) != 1:
        raise SystemExit(f'Expected one exact production method {name}, got {len(matches)}')
    start = matches[0].start()
    index = source.index('{', matches[0].start())
    depth = 0
    state = 'code'
    while index < len(source):
        char = source[index]
        following = source[index:index + 2]
        if state == 'line':
            if char == '\n': state = 'code'
        elif state == 'block':
            if following == '*/': state = 'code'; index += 1
        elif state in ('string', 'char'):
            if char == '\\': index += 1
            elif (state == 'string' and char == '"') or (state == 'char' and char == "'"):
                state = 'code'
        elif following == '//': state = 'line'; index += 1
        elif following == '/*': state = 'block'; index += 1
        elif char == '"': state = 'string'
        elif char == "'": state = 'char'
        elif char == '{': depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0: return source[start:index + 1]
        index += 1
    raise SystemExit(f'Unterminated method {name}')

fields = re.findall(r'^    private (?:GuiConnecting requestedConnectingScreen|String requestedConnectingPolicy);$', source, re.M)
methods = '\n\n'.join(fields + [method('reconnectClient'), method('isConnectingTo', False), method('canonicalAddress', False)])
assert template.count('/* EXACT_PRODUCTION_METHODS */') == 1
Path(sys.argv[3]).write_text(template.replace('/* EXACT_PRODUCTION_METHODS */', methods))
print('SessionActions source SHA256=' + hashlib.sha256(source.encode()).hexdigest())
print('Extracted reconnect methods/state SHA256=' + hashlib.sha256(methods.encode()).hexdigest())
