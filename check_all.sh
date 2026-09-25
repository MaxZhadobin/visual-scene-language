#!/usr/bin/env bash
# check_all.sh — единый чек-пайплайн проекта VSL (quality gates S0–S7).
# Реализация контракта CHECK_ALL.md §3–§5 1:1 (см. DEC-020 в DECISIONS.md).
#
# Запуск (из корня проекта):  bash check_all.sh
#   exit 0 — все шаги ok → финал 'ALL GREEN (8/8)'
#   exit 1 — первый упавший шаг: '❌ fail', пайплайн останавливается на нём
# Лог каждого прогона: .taocoder/check_runs/<timestamp>.log (каталог создаётся скриптом)

set -u

LOG_DIR=".taocoder/check_runs"
LOG_FILE="${LOG_DIR}/$(date +%Y%m%d_%H%M%S).log"
mkdir -p "$LOG_DIR"

# Весь вывод (stdout+stderr) дублируется в терминал и в лог текущего прогона.
exec > >(tee "$LOG_FILE") 2>&1

print_ok()   { printf '[%s] %-16s✅ ok\n' "$1" "$2"; }
print_fail() { printf '[%s] %-16s❌ fail\n' "$1" "$2"; }

# --- S0. Prerequisites: python3 (>= 3.8) и import matplotlib — §4 S0 ---
s0_prerequisites() {
  python3 --version >/dev/null \
    && python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' \
    && python3 -c 'import matplotlib'
}

# --- S1. Синтаксис кода: py_compile vsl_to_image.py — §4 S1 1:1 ---
s1_py_compile() {
  python3 -m py_compile vsl_to_image.py
}

# --- S2. Валидация JSON-сцены: mockup-контракт — §4 S2 1:1 ---
s2_json_scene() {
  python3 - <<'EOF'
import json
d = json.load(open('vsl_scene_example.json'))
assert {'width', 'height'} <= d['canvas'].keys()
for o in d['objects']:
    assert o['type'] == 'rectangle'
    assert {'x', 'y'} <= o['position'].keys()
    assert {'width', 'height'} <= o['size'].keys()
print('scene ok')
EOF
}

# --- S3. Smoke-тест рендеринга (headless, MPLBACKEND=Agg) — §4 S3 1:1 ---
# Успех = exit code 0; ожидаемый UserWarning от plt.show() на stderr не влияет на результат.
s3_render_smoke() {
  MPLBACKEND=Agg python3 vsl_to_image.py
}

# --- S4. Целостность документации: 8 архитектурных документов — §4 S4 1:1 ---
s4_docs_integrity() {
  python3 - <<'EOF'
import pathlib
docs = ['README_AI.md', 'PRODUCT_CONCEPT.md', 'TARGET_AUDIENCE.md',
        'DESIGN_SYSTEM.md', 'ARCHITECTURE.md', 'DECISIONS.md', 'ROADMAP.md', 'CHECK_ALL.md']
for d in docs:
    assert pathlib.Path(d).exists(), f'missing: {d}'
print('docs ok:', len(docs))
EOF
}

# --- S5. Lint TypeScript-кода SDK: eslint — §8 S5 (Phase 1, ревизия на TS-стек) ---
s5_ts_lint() {
  npm run lint
}


# --- S6. Typecheck TypeScript-кода SDK: tsc --noEmit — §8 S6 (Phase 1, ревизия на TS-стек) ---
s6_ts_typecheck() {
  npm run typecheck
}


# --- S7. Сборка SDK + тесты с порогом покрытия 80% — §8 S7 (Phase 1, ревизия на TS-стек) ---
# Порог 80% (statements/branches/functions/lines) зафиксирован в jest.config.js coverageThreshold —
# jest завершается с ненулевым кодом при его нарушении. Решение о пороге: DEC-021 (DECISIONS.md).
s7_ts_build_and_tests() {
  npm run build && npm run test:coverage
}

# Раннер шага: успех → '[SX] name ✅ ok'; провал → '[SX] name ❌ fail', stop-on-fail, exit 1.
run_step() {
  local step="$1" name="$2" fn="$3"
  if "$fn"; then
    print_ok "$step" "$name"
  else
    print_fail "$step" "$name"
    echo "STOP: ${step} (${name}) failed — pipeline halted, exit 1. Log: ${LOG_FILE}"
    exit 1
  fi
}

main() {
  run_step "S0" "prerequisites"  s0_prerequisites
  run_step "S1" "py_compile"     s1_py_compile
  run_step "S2" "json scene"     s2_json_scene
  run_step "S3" "render smoke"   s3_render_smoke
  run_step "S4" "docs integrity" s4_docs_integrity
  # --- S5–S7: TypeScript-шаги SDK (CHECK_ALL.md §8, активация Phase 1) ---
  run_step "S5" "ts lint"        s5_ts_lint
  run_step "S6" "ts typecheck"   s6_ts_typecheck
  run_step "S7" "ts build+test"  s7_ts_build_and_tests
  echo "ALL GREEN (8/8)"
}

main
exit 0