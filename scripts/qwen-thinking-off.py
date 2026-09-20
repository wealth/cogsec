#!/usr/bin/env python3
"""Make a Qwen 3.x chat template default to thinking OFF.

LM Studio's MLX engine ignores enable_thinking / reasoning_effort, so the template opens a <think> block
the model never closes and the whole reply is filed as reasoning. Flipping the template default fixes it
at the source. Works on chat_template.jinja and on the chat_template embedded in tokenizer_config.json.

  python3 scripts/qwen-thinking-off.py ~/.cache/lm-studio/models/lmstudio-community/Qwen3.5-9B-MLX-4bit
  python3 scripts/qwen-thinking-off.py <model dir> --restore

Backups are written next to the originals as *.orig. Reload the model in LM Studio afterwards.
"""
import json, sys, shutil
from pathlib import Path

OLD = ("    {%- if enable_thinking is defined and enable_thinking is false %}\n"
       "        {{- '<think>\\n\\n</think>\\n\\n' }}\n"
       "    {%- else %}\n"
       "        {{- '<think>\\n' }}\n"
       "    {%- endif %}\n")
NEW = ("    {%- if enable_thinking is defined and enable_thinking is true %}\n"
       "        {{- '<think>\\n' }}\n"
       "    {%- else %}\n"
       "        {{- '<think>\\n\\n</think>\\n\\n' }}\n"
       "    {%- endif %}\n")

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        print(__doc__); sys.exit(2)
    d = Path(args[0]).expanduser()
    restore = '--restore' in sys.argv
    touched = 0
    for name in ('chat_template.jinja', 'tokenizer_config.json'):
        f = d / name
        bak = d / (name + '.orig')
        if restore:
            if bak.exists():
                shutil.copy2(bak, f); print(f'restored {f}'); touched += 1
            continue
        if not f.exists():
            continue
        if name.endswith('.jinja'):
            s = f.read_text()
            if OLD not in s:
                print(f'{name}: already patched or unexpected template' if NEW in s else f'{name}: think block not found'); continue
            if not bak.exists(): shutil.copy2(f, bak)
            f.write_text(s.replace(OLD, NEW)); print(f'patched {f}'); touched += 1
        else:
            cfg = json.loads(f.read_text())
            t = cfg.get('chat_template')
            if not isinstance(t, str) or OLD not in t:
                print(f'{name}: no embedded template to patch' if not isinstance(t, str) or NEW in t else f'{name}: think block not found'); continue
            if not bak.exists(): shutil.copy2(f, bak)
            cfg['chat_template'] = t.replace(OLD, NEW)
            f.write_text(json.dumps(cfg, indent=2, ensure_ascii=False)); print(f'patched {f}'); touched += 1
    if touched:
        print('Now reload the model:  lms unload <id> && lms load <id>')
    sys.exit(0 if touched else 1)

if __name__ == '__main__':
    main()
