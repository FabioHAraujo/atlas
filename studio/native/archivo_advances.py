#!/usr/bin/env python3
"""Regenerates studio/src/captions/archivo.ts: advance widths (ems) of the shipped Archivo at the caption weight."""
import json
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

font = TTFont("studio/assets/fonts/archivo-var.woff2")
inst = instantiateVariableFont(font, {"wght": 700, "wdth": 100}, inplace=False)
cmap, hm, upm = inst.getBestCmap(), inst["hmtx"], inst["head"].unitsPerEm
chars = [chr(c) for c in range(32, 127)] + list("áàâãäçéèêëíìîïóòôõöúùûüñÁÀÂÃÄÇÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÑ—–…•·’‘“”")
rows = [(c, round(hm[cmap[ord(c)]][0] / upm, 3)) for c in chars if ord(c) in cmap]
letters = [w for c, w in rows if c.isalpha()]
avg = round(sum(letters) / len(letters), 3)
body = ",\n".join(f"\t{json.dumps(c, ensure_ascii=False)}: {w}" for c, w in rows)
header = open("studio/src/captions/archivo.ts").read().split("export const")[0]
open("studio/src/captions/archivo.ts", "w").write(f"{header}export const ARCHIVO_700_EM: Record<string, number> = {{\n{body},\n}};\n\n/** Mean advance of the letters in the table: the fallback for a character the font table does not carry. */\nexport const ARCHIVO_700_AVG_EM = {avg};\n")
