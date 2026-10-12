# Backend · Ajedrez (Modelos y Simulación)

API REST en **Node.js 20+ / Express 5 / PostgreSQL**, con reglas de ajedrez sobre **chess.js** (envuelto en la clase `Tablero`).
Equipo Backend: Marcos Teixido, German Velazquez, Axel Nievas.

Estado: **Fase 1 completa** (juego local, reglas, persistencia jugada a jugada, pausa/reanudación, abandono, historial y PGN)
y **modo vs. Stockfish funcionando** (`StockfishAdapter` habla UCI con el binario). La IA propia ya está conectada
(`engine-move` + respaldo en Stockfish); falta el microservicio Python de Desarrollo Simulación.

## Documentación

La carpeta `docs/` tiene los PDF del equipo Backend:

| Archivo | Qué contiene |
|---|---|
| `Backend_Estado_y_API.pdf` | Estado de la fase (pestaña 08), alcance, endpoints, errores y pruebas |
| `Backend_Observaciones_Diseno_Tecnico.pdf` | 14 puntos del diseño técnico que faltan o se contradicen, con la propuesta de Backend |
| `Backend_Modelo_de_Datos.pdf` | Propuesta de script de base para probar el backend (no modifica el modelo de Modelado de Datos) |
| `Backend_Stockfish.pdf` | Adaptador mínimo de prueba para Stockfish (el motor es responsabilidad de Desarrollo Simulación) |
| `IA_Propia_Que_Falta.pdf` | Contrato con el servicio de IA y tareas pendientes de Simulación (Backend no modificó la IA) |

## Cómo levantarlo

El proyecto usa **pnpm** (la versión está fijada en `package.json`, campo `packageManager`).
La primera vez, habilitalo con Corepack (viene con Node):

```bash
corepack enable
```

```bash
cd backend
pnpm install
cp .env.example .env        # completar DATABASE_URL (en Windows: copy .env.example .env)
pnpm migrate                # crea tablas, vista de entrenamiento y perfiles de dificultad
pnpm dev                    # http://localhost:3001
```

Sin base de datos (solo para probar rápido): `pnpm dev:memory`.

No usar `npm install`: generaría un `package-lock.json` que no va al repo. El lockfile es `pnpm-lock.yaml`.

## Stockfish

1. Bajar Stockfish de https://stockfishchess.org/download/ y descomprimirlo.
2. En el `.env`, poner la ruta al ejecutable en `STOCKFISH_PATH` (puede ser absoluta, o relativa a la carpeta `backend/`).
   Ejemplo en Windows: `STOCKFISH_PATH=C:\Users\yo\Escritorio\stockfish\stockfish-windows-x86-64-universal.exe`
3. Al levantar el servidor, la consola muestra qué ruta va a usar. El motor se abre recién en la primera jugada de la máquina
   y queda abierto para las siguientes (todas las partidas comparten el mismo proceso).

Si la ruta está mal, `engine-move` responde `503 ENGINE_UNAVAILABLE` con un mensaje que lo indica.

Cómo juega: `setoption name Skill Level value X` (Fácil 3, Medio 10, Difícil 20, de la tabla `difficulty_profiles`),
`position fen ...`, `go movetime 1000`. Si no responde en `STOCKFISH_TIMEOUT_MS` (3000 ms) devuelve `504 ENGINE_TIMEOUT`,
cierra el proceso colgado y lo vuelve a abrir en el próximo pedido.

## Pruebas

```bash
pnpm test                   # 70 pruebas, no necesitan base de datos ni Stockfish (usan un motor UCI falso)
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/ajedrez_test pnpm test:integration
```

Prueba con Stockfish de verdad (PowerShell):

```powershell
$env:STOCKFISH_TEST_PATH = "C:\ruta\a\stockfish.exe"; pnpm test
```


`TEST_DATABASE_URL` debe apuntar a una base **de prueba**: la prueba de integración borra sus tablas.

## Estructura

Respeta las carpetas que ya existen en el repo (`controllers`, `engines`, `models`, `routes`, `validators`, `tests`)
y suma las que hacen falta para separar capas (`services`, `repositories`, `config`, `db`, `middlewares`).

```
db/migrations/001_init.sql          modelo físico (tablas, índices, vista v_training_moves, perfiles)
src/controllers/                    endpoints: crear partida, enviar jugada, historial (solo traducen HTTP)
src/routes/                         rutas de Express -> controllers
src/validators/Tablero.js           reglas del ajedrez sobre chess.js: legalidad (RN-02 Bis) y fin de partida (RN-03)
src/validators/ValidadorDeJugada.js forma de los datos de entrada de la API
src/models/                         enums del dominio y mapeo de filas de la base a entidades
src/engines/                        OpponentStrategy y oponentes, GameSessionFactory, AIServiceAdapter,
                                    StockfishAdapter (proceso hijo + protocolo UCI)
src/services/                       GestorDePartida (CU-01..04, CU-06) · ServicioHistorial (CU-05)   [nueva]
src/repositories/                   PostgresStore (pg) · InMemoryStore (pruebas) · un repo por tabla   [nueva]
src/config/env.js                   variables de entorno + fail-fast                                    [nueva]
src/db/migrate.js                   corre las migraciones                                               [nueva]
src/middlewares/errorHandler.js     formato único de errores                                            [nueva]
tests/                              pruebas (node:test + supertest)
```

## API

Todas las respuestas son JSON. Los errores tienen siempre la forma
`{ "error": { "code": "...", "message": "...", "details"?: {...} } }`.

| Método | Ruta | CU | Qué hace |
|---|---|---|---|
| GET | `/health` | – | Estado del servidor y de la base |
| GET | `/difficulty-profiles` | CU-01 | Perfiles FACIL/MEDIO/DIFICIL por motor, con rango ELO |
| POST | `/games` | CU-01 | Crea la partida en estado `IN_PROGRESS` |
| GET | `/games` | CU-05 | Historial. Filtros: `mode`, `difficulty`, `status`, `result`, `alias`, `limit`, `offset` |
| GET | `/games/:id` | CU-05 | Estado actual + lista de jugadas |
| GET | `/games/:id/pgn` | CU-05 | Exporta la partida en PGN |
| GET | `/games/:id/legal-moves?square=e2` | CU-06 | Destinos legales de una pieza |
| POST | `/games/:id/moves` | CU-06 | Jugada del humano |
| POST | `/games/:id/engine-move` | CU-03/04 | Jugada de la máquina |
| POST | `/games/:id/pause` | CU-02/03/04 | "Guardar y salir" → `PAUSED` |
| POST | `/games/:id/resume` | CU-05 | Reanuda una partida `PAUSED` |
| POST | `/games/:id/resign` | RN-03 | Abandono. Cuerpo `{ "color": "WHITE" \| "BLACK" }` |

### POST /games

```json
{ "mode": "LOCAL", "whiteAlias": "Ana", "blackAlias": "Beto" }
{ "mode": "STOCKFISH", "alias": "German", "difficulty": "MEDIO", "playerColor": "BLACK" }
```

`mode`: `LOCAL | STOCKFISH | AI` · `difficulty`: `FACIL | MEDIO | DIFICIL` · `playerColor`: `WHITE | BLACK`.

### Estado de partida (respuesta de casi todos los endpoints)

```json
{
  "gameId": "uuid", "mode": "STOCKFISH", "difficulty": "MEDIO",
  "white": { "type": "HUMAN", "alias": "German" },
  "black": { "type": "STOCKFISH", "alias": "Stockfish" },
  "status": "IN_PROGRESS", "fen": "...", "turn": "WHITE", "inCheck": false,
  "machineTurn": false, "result": null, "endReason": null,
  "startedAt": "...", "endedAt": null
}
```

**`machineTurn: true` → el frontend llama a `POST /games/:id/engine-move`.** Pasa al crear una partida con
`playerColor: BLACK` y después de cada jugada del humano contra la máquina.

### POST /games/:id/moves

Cuerpo: `{ "from": "e7", "to": "e8", "promotion": "q" }` (`promotion` solo si un peón corona: `q | r | b | n`).
Respuesta: `{ "valid": true, "move": { "moveNumber", "color", "san", "uci" }, ...estado }`.

### Códigos de error

| HTTP | code | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` / `INVALID_JSON` | Datos mal formados |
| 404 | `NOT_FOUND` | La partida no existe |
| 409 | `INVALID_STATE` | Mover en partida pausada/finalizada, reanudar una no pausada, etc. |
| 409 | `NOT_YOUR_TURN` | El humano mueve en turno de la máquina o al revés |
| 409 | `CONCURRENT_MOVE` | Dos pedidos guardaron la misma jugada a la vez: recargar |
| 422 | `ILLEGAL_MOVE` | Jugada ilegal (respuesta con `valid: false`) |
| 422 | `PROMOTION_REQUIRED` | Peón a la última fila sin `promotion`: mostrar el diálogo de coronación |
| 502 | `ENGINE_BAD_MOVE` | El motor devolvió una jugada inválida (reintentable) |
| 503 | `ENGINE_UNAVAILABLE` | Motor o servicio IA no disponible (reintentable) |
| 504 | `ENGINE_TIMEOUT` | El motor no respondió en 3 s: ofrecer **reintentar o pausar** (CU-03 3a) |

## Decisiones tomadas (detalle en el PDF de observaciones)

- Estados en inglés: `IN_PROGRESS` (En Curso), `PAUSED` (Pendiente/Pausada), `FINISHED` (Finalizada).
- `games` suma `status`, `end_reason`, `white_alias`, `black_alias`. `moves` suma `uci` y `fen_before_key`.
- Jugada + FEN + cierre de partida se guardan en **una transacción**.
- Al cargar una partida el tablero se **reconstruye desde las jugadas** (necesario para la triple repetición).
- La IA propia hace el **fallback a Stockfish Skill Level 0** cuando el servicio responde `source: "none"`.
- `v_training_moves`: vista con jugadas de partidas **finalizadas** solamente, para el entrenamiento de la IA.
