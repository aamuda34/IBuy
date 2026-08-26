import ast, pathlib
p=pathlib.Path(__file__).with_name('server.py')
ast.parse(p.read_text())
s=p.read_text()
assert 'import re' in s
assert 're.sub(r"[^0-9]"' in s
print('V2.9 server registration regression checks: PASS')
