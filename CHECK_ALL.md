# CHECK_ALL.md — Visual Scene Language (VSL)

> Defensive Publication | Author: Maxim Zhadobin | Date: 19.09.2026 | Version: v0.1
> License: CC BY 4.0
>
> **Важно:** Этот документ — контракт единой проверки качества проекта VSL.
> Он определяет, что проверяет `check_all.sh`, как его запускать, как интерпретировать
> результаты и где искать логи. Скрипт реализован и синхронизирован с документом (S0–S7,
> соответствие 1:1 по DEC-020). Создание CHECK_ALL.md supersede часть DEC-011
> («CHECK_ALL.md не нужен») — см. DEC-020 в [DECISIONS.md](./DECISIONS.md).

---

## 1. Overview

CHECK_ALL.md описывает канонический чек-пайплайн проекта VSL — минимальный набор
проверок (quality gates), обязательный перед завершением любой задачи.

Текущее состояние проекта — **Phase 1 / M1.1 (SDK, Snapshot generation)**: TypeScript SDK
(`src/` — capture/segmentation/builder) + python-скрипт рендеринга + пример JSON-сцены +
8 архитектурных документов. Чек-пайплайн активирован в составе S0–S7: python S0–S4 и
TypeScript S5–S7 (lint / typecheck / build+tests — см. §8). Резерв: S8+ (там же).

**Принципы:**
- Все применимые шаги обязаны завершаться `✅ ok` — иначе задача не считается выполненной
- Проверки запускаются из корня проекта, локально (CI подключается позже)
- Логи каждого прогона сохраняются в `.taocoder/check_runs/`

---

## 2. Что проверяем (scope)

| Артефакт | Роль в проверках |
|----------|------------------|
| `src/**` + конфиги TS (`package.json`, `tsconfig.json`, `jest.config.js`, `eslint.config.js`, `tsup.config.ts`) | Код SDK `@vsl/sdk` (capture/segmentation/builder) — S5, S6, S7 |
| `vsl_to_image.py` | Python-код рендеринга (matplotlib) — S1, S3 |
| `vsl_scene_example.json` | Тестовая сцена (mockup-формат) — S2, S3 |
| 8 `.md`-документов (см. [README_AI.md §3](./README_AI.md)) | Целостность документации — S4 |
| `vsl_editor_mockup.ipynb` | Вне чека: интерактивный mockup, автоматически не запускается |

---

## 3. Как запускать

**Способ запуска (из корня проекта):**

~~~bash
bash check_all.sh
~~~
**Статус:** `check_all.sh` реализован (S0–S7) и синхронизирован с этим документом 1:1
(DEC-020); финал успешного прогона — `ALL GREEN (8/8)`.

- Рабочая директория: корень проекта
- Exit code: `0` — все шаги ok, `1` — хотя бы один fail
- Любой `❌ fail` останавливает пайплайн на первом упавшем шаге

---

## 4. Шаги проверки (quality gates)

### S0. Prerequisites

Наличие окружения: `python3 --version` (требуется ≥ 3.8) и `python3 -c "import matplotlib"`.

### S1. Синтаксис кода

~~~bash
python3 -m py_compile vsl_to_image.py
~~~
Проверяет, что единственный скрипт проекта компилируется без синтаксических ошибок.

### S2. Валидация JSON-сцены

~~~bash
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
~~~
Проверяет **mockup-контракт сцены**: плоский `canvas` (width/height) + объекты с
`type`/`position{x,y}`/`size{width,height}` — именно этот контракт читает
`vsl_to_image.py`. О различии с каноническим VSL JSON — см. §7.

### S3. Smoke-тест рендеринга (headless)

~~~bash
MPLBACKEND=Agg python3 vsl_to_image.py
~~~
Прогон примера на тестовой сцене без GUI. **Обязателен headless-бэкенд
(`MPLBACKEND=Agg`)**: скрипт завершается `plt.show()` — без Agg он откроет GUI-окно
и заблокирует автоматический прогон. Успех: exit code 0.

### S4. Целостность документации

~~~bash
python3 - <<'EOF'
import pathlib
docs = ['README_AI.md', 'PRODUCT_CONCEPT.md', 'TARGET_AUDIENCE.md',
        'DESIGN_SYSTEM.md', 'ARCHITECTURE.md', 'DECISIONS.md', 'ROADMAP.md', 'CHECK_ALL.md']
for d in docs:
    assert pathlib.Path(d).exists(), f'missing: {d}'
print('docs ok:', len(docs))
EOF
~~~

Проверяет, что все 8 архитектурных документов присутствуют в корне проекта.

### S5. Lint TypeScript-кода SDK

~~~bash
npm run lint
~~~
`eslint .` — ESLint 9 (flat config) по TS-коду SDK и тестам.

### S6. Typecheck TypeScript-кода SDK

~~~bash
npm run typecheck
~~~
`tsc --noEmit` — строгая проверка типов (strict) без эмиссии артефактов.

### S7. Сборка SDK + тесты с порогом покрытия

~~~bash
npm run build && npm run test:coverage
~~~
Сборка ESM/CJS/DTS (tsup) + Jest (jsdom) с порогом покрытия 80% по всем метрикам
(DEC-021; `coverageThreshold` в `jest.config.js` — нарушение порога даёт ненулевой
exit code). Ревизия шагов на TS-стек и резерв S8+ — §8.

---

## 5. Логи и формат вывода

Логи каждого прогона сохраняются в `.taocoder/check_runs/<timestamp>.log`.
Формат вывода — по шагам:

~~~
[S0] prerequisites   ✅ ok
[S1] py_compile      ✅ ok
[S2] json scene      ✅ ok
[S3] render smoke    ✅ ok
[S4] docs integrity  ✅ ok
[S5] ts lint         ✅ ok
[S6] ts typecheck    ✅ ok
[S7] ts build+test   ✅ ok
ALL GREEN (8/8)
~~~

`✅ ok` — шаг прошёл. `❌ fail` — шаг упал: пайплайн останавливается на первом
упавшем шаге, exit code 1, задача не считается выполненной.

## 6. Интерпретация сбоев

| Шаг | Типичная причина | Что делать |
|-----|------------------|------------|
| S0 | нет python3 или matplotlib | `pip install matplotlib` |
| S1 | синтаксическая ошибка в `vsl_to_image.py` | чинить код скрипта, не сцену |
| S2 | сцена не соответствует mockup-контракту (§4 S2) | чинить `vsl_scene_example.json` |
| S3 | прогон открыл GUI / завис | убедиться в `MPLBACKEND=Agg` |
| S4 | отсутствует один из 8 документов | восстановить/создать документ |
| S5 | lint-ошибки в TS-коде | прогнать `npm run lint` локально, чинить код |
| S6 | ошибка типов в TS-коде | прогнать `npm run typecheck`, чинить типы |
| S7 | упала сборка/тесты или покрытие < 80% (DEC-021) | `npm run build` / `npm run test:coverage` локально |

## 7. Mockup-формат vs канонический VSL JSON

`vsl_scene_example.json` — **mockup-формат**: плоский `canvas.width/height`, полные
ключи `type`/`position`/`size`, согласованный с рендерером `vsl_to_image.py`. Он
**не совпадает** с каноническим VSL JSON из [README_AI.md §4.2](./README_AI.md)
(короткие ключи `t`/`p`/`s`, вложенный `canvas.viewport`, относительные координаты
[0.0–1.0]).

Шаг S2 валидирует mockup-контракт, а не VSL-спеку. При появлении канонического
рендерера добавить отдельный шаг валидации VSL JSON — см. §8.

## 8. Расширение пайплайна (S5–S7 активированы в Phase 1)

Изначально S5+ резервировались с Python-инструментами (ruff/mypy/pytest) — раздел
написан до появления TypeScript-кода. С началом M1.1 ([ROADMAP.md](./ROADMAP.md))
шаги активированы в ревизии на TS-стек:

- **S5 lint** — `eslint .` (ESLint 9, flat config) — вместо ruff/flake8
- **S6 typecheck** — `tsc --noEmit` (strict) — вместо mypy
- **S7 build + unit-тесты** — `tsup` (ESM/CJS/DTS) + `jest --coverage` (jsdom); порог
  покрытия 80% по всем метрикам зафиксирован решением DEC-021
  ([DECISIONS.md](./DECISIONS.md)), контроль — `coverageThreshold` в `jest.config.js`

- **Demo-прогон (packaging-smoke, M1.2)** — `npm run demo:cache-diff`: сборка + запуск
  реального пайплайна capture→segment→build→cache→diff в plain Node ESM
  (scripts/demo-cache-diff.mjs, jsdom-окно, импорт dist/index.mjs): печатает
  [full] → [diff] идентичный повтор → [diff] точечная мутация с размерами и % экономии.
  Вне gate S0–S7 — верифицируется вручную при завершении милстоуна (M1.2).

Остаются зарезервированными:

- **S8 VSL schema validation** — валидация канонического VSL JSON по [DESIGN_SYSTEM.md §4](./DESIGN_SYSTEM.md)
- **CI/CD** — тот же `check_all.sh` как gate в CI (для M1.1 отложено — только локальный запуск)

Каждый новый шаг добавляется в `check_all.sh` и в этот документ одновременно
(DEC-020: расхождение скрипта и документа = провал соответствующего S-шага).

## 9. Cross-References

- [README_AI.md](./README_AI.md) — project bible, Document Index (§3)
- [ARCHITECTURE.md](./ARCHITECTURE.md) — высокоуровневая архитектура системы
- [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) — каноническая схема VSL JSON (§4)
- [DECISIONS.md](./DECISIONS.md) — DEC-011 (частично superseded этим документом), DEC-020, DEC-021
- [ROADMAP.md](./ROADMAP.md) — фазы активации шагов S5+

---

*End of CHECK_ALL.md — контракт чек-пайплайна проекта VSL.*