# AFRODITA — Checklist de re-verificación Supabase ↔ AFRODITA

Procedimiento reutilizable para verificar, tras la aplicación autorizada de las
migraciones pendientes, que el proyecto Supabase remoto está preparado para que
AFRODITA lea el catálogo de verificadas por la RPC
`public.get_afrodita_verified_catalog(p_group_id)`.

Este documento es una **fotografía del procedimiento**, no una garantía del
estado remoto. Ninguna casilla puede marcarse como cumplida sin evidencia nueva
obtenida al ejecutarla. El estado observado más abajo corresponde a la auditoría
de **2026-10-29** y puede haber cambiado desde entonces.

## Identificación del proyecto

| Campo | Valor observado en la auditoría |
|---|---|
| Proyecto | `npruzbrrrvdrleslpivr` ("chris070320's Project") |
| Región / motor | `ca-central-1` / PostgreSQL 17.6.1 |
| Estado | `ACTIVE_HEALTHY` |

Confirma siempre el project ref antes de cada ronda: una consulta ejecutada en
el proyecto equivocado no demuestra nada sobre este.

## Snapshot de la auditoría 2026-10-29 (estado entonces, no actual)

- No existía `public.get_afrodita_verified_catalog` (0 filas en `pg_proc`;
  error `42883` al consultar `has_function_privilege`).
- No existía `public.afrodita_verified_catalog_groups` (0 filas en `pg_class`).
- `verified_users` solo tenía las columnas de la migración base 006; faltaban
  `valid_until` y `verification_method`.
- RLS habilitado en `verified_users` y `groups`; `anon` y `authenticated` sin
  permiso de SELECT directo sobre ambas.
- `verified_users` con 0 filas.
- Historial de migraciones del CLI: solo `008`.
- Migraciones locales pendientes de revisión y aplicación por persona autorizada:
  - `CERBERO/supabase/migrations/012_afrodita_verified_catalog_read.sql`
  - `CERBERO/supabase/migrations/013_afrodita_verified_catalog_validity.sql`

## Políticas de seguridad (invariantes)

1. La clave de AFRODITA (`AFRODITA_SUPABASE_KEY`) debe ser **publishable
   (`sb_publishable_…`) o JWT legacy con `role=anon`**; nunca `service_role`,
   `sb_secret_…` ni otra credencial privilegiada. El arranque local rechaza las
   claves privilegiadas (ver `src/config.ts`, `isPublicSupabaseKey`).
2. **`anon` debe poder ejecutar la RPC, pero no debe obtener acceso directo a
   las tablas protegidas** (`verified_users`, `groups`,
   `afrodita_verified_catalog_groups`). Si alguna ronda muestra
   `SELECT = true` para `anon` sobre esas tablas, detener el proceso y tratarlo
   como incidencia de seguridad.
3. Toda verificación remota usa únicamente consultas de solo lectura (rol
   `supabase_read_only_user` o SQL editor en modo lectura). Sin INSERT, UPDATE,
   DELETE, DDL ni migraciones desde este procedimiento.
4. **Trazabilidad de migraciones:** aplicar SQL por el editor del dashboard puede
   no registrar la versión en `supabase_migrations.schema_migrations`. Seguir el
   procedimiento de despliegue acordado (revisión humana + registro del cambio)
   y anotar en la tabla de registro quién aplicó qué y cuándo.

## Categorías de comprobaciones

- **A — Solo lectura remota:** consultas SQL de catálogo y de datos, sin
  escrituras. Ejecutables en cualquier momento.
- **B — Pruebas locales:** suite con mocks y lectura local del catálogo con
  clave publishable propia. No requieren tocar Supabase más allá de la lectura.
- **C — Acciones que requieren autorización humana:** aplicar migraciones,
  habilitar grupos, generar claves. No forman parte de la ejecución de este
  checklist; solo se registra su evidencia.
- **D — Verificación funcional coordinada:** pruebas de extremo a extremo con el
  bot en un grupo de prueba, con autorización explícita y sin publicar contenido
  real. Solo después de que A y B estén conformes.

## A. Comprobaciones de solo lectura remota

SQL probado con el rol `supabase_read_only_user` (canal autorizado durante la
auditoría: `SUPABASE_RUN_READ_ONLY_QUERY` de la conexión Composio, o SQL editor
en el proyecto correcto).

| ID | Comprobación | SQL / acción | Criterio de conformidad |
|---|---|---|---|
| A1 | La RPC existe con la firma exacta | `select n.nspname, p.proname, l.lanname, p.prosecdef, p.provolatile, pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.proname='get_afrodita_verified_catalog'` | 1 fila: esquema `public`, argumento `(p_group_id bigint)`, retorno `TABLE(group_id bigint, user_id bigint, username text, display_name text)`, `prosecdef=true`, `provolatile='i'` (stable) |
| A2 | Definición y filtros | `select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='get_afrodita_verified_catalog' and n.nspname='public'` | Exige allowlist `enabled=true`, `groups.active=true`, `verified.verified=true`, `revoked_at is null`, `limit 500`, `set search_path = pg_catalog, public`. Con 013 aplicada debe filtrar además `valid_until is null or (isfinite(valid_until) and valid_until > now())`; registrar cuál de las dos variantes está activa |
| A3 | Permisos de ejecución | `select has_function_privilege('anon','public.get_afrodita_verified_catalog(bigint)','EXECUTE') as anon_execute, has_function_privilege('authenticated','public.get_afrodita_verified_catalog(bigint)','EXECUTE') as authenticated_execute` | `anon_execute = true` (requisito de la clave publishable de AFRODITA). `authenticated_execute` se anota como observación |
| A4 | Allowlist existe y está cerrada | `select c.relname, c.relrowsecurity, has_table_privilege('anon','public.afrodita_verified_catalog_groups','SELECT') as anon_select, has_table_privilege('authenticated','public.afrodita_verified_catalog_groups','SELECT') as authenticated_select from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='afrodita_verified_catalog_groups'` | 1 fila, `relrowsecurity = true`, `anon_select = false`, `authenticated_select = false` (escritura solo `service_role`) |
| A5 | Columnas de vigencia y método | `select column_name, data_type from information_schema.columns where table_schema='public' and table_name='verified_users' and column_name in ('valid_until','verification_method')` | `valid_until` = `timestamp with time zone` (dependencia de 013). `verification_method` puede no existir: AFRODITA no la consume; se anota como observación del contrato compartido |
| A6 | RLS y sin acceso directo | `select c.relname, c.relrowsecurity, has_table_privilege('anon', 'public.'\|\|c.relname, 'SELECT') as anon_select, has_table_privilege('authenticated', 'public.'\|\|c.relname, 'SELECT') as authenticated_select from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('verified_users','groups')` | `relrowsecurity = true` y ambos `*_select = false` en las dos tablas. Si `anon_select = true`, incidencia de seguridad |
| A7 | Grupos habilitados explícitamente | `select a.group_id, a.enabled, g.active as group_active from public.afrodita_verified_catalog_groups a left join public.groups g on g.chat_id=a.group_id order by a.group_id` (requiere rol con acceso: `service_role` o postgres en el editor) | Cada grupo de prueba figura con `enabled=true` y `group_active=true`. Sin filas habilitadas, el catálogo devolverá `[]` |
| A8 | Verificaciones activas | `select group_id, count(*) filter (where verified and revoked_at is null) as activas from public.verified_users group by group_id` | Existe al menos un grupo con `activas >= 1` para el grupo de prueba. La auditoría encontró 0 filas: si sigue vacía, ZEUS no ha persistido verificaciones |
| A9 | Historial y trazabilidad | Canal `SUPABASE_LIST_MIGRATION_HISTORY` o `select version from supabase_migrations.schema_migrations order by version` | Anotar qué versiones aparecen. La auditoría solo vio `008`; si 012/013 se aplicaron por editor puede no reflejarse — justificarlo con el registro humano (C1) |

## B. Pruebas locales (sin contenido real)

| ID | Comprobación | Comando / acción | Criterio de conformidad |
|---|---|---|---|
| B1 | Suite con mocks (fail-closed) | `npm test` en `AFRODITA/` | 66/66, incluidos `tests/authorization-deny.test.ts` y `tests/verified-catalog-fail-closed.test.ts` (red, timeout, HTTP, payload malformado, cross-group, revocación, claves privilegiadas) |
| B2 | Tipos y build | `npm run typecheck` y `npm run build` | Ambos limpios |
| B3 | Lectura real de solo lectura (Fase B) | Con `AFRODITA_SUPABASE_URL`/`AFRODITA_SUPABASE_KEY` publishable en el entorno local (nunca pegar la clave en el chat): `node --input-type=module --eval "import { getActiveVerifiedModels } from './dist/verified-users.js'; const m = await getActiveVerifiedModels(<GRUPO_DE_PRUEBA>, { supabaseUrl: process.env.AFRODITA_SUPABASE_URL, supabaseKey: process.env.AFRODITA_SUPABASE_KEY }); console.log('filas:', m.length);"` | `filas: N` con N>=1. `filas: 0` → grupo no habilitado o sin verificadas. `AFRODITA_SUPABASE_HTTP_404` → RPC ausente (PGRST202). `HTTP_401/403` → clave o proyecto incorrectos |
| B4 | Fail-closed de configuración | Arranque local sin las dos variables de Supabase; y con una clave no permitida | Sin variables: el bot arranca y las funciones de catálogo fallan cerrado. Con clave privilegiada: `AfroditaConfigError` y arranque abortado |

## C. Acciones con autorización humana (solo se registra evidencia)

| ID | Acción | Responsable | Evidencia a registrar |
|---|---|---|---|
| C1 | Aplicación de `012_afrodita_verified_catalog_read.sql` y `013_afrodita_verified_catalog_validity.sql` tras revisión | Persona autorizada | Fecha, método (CLI o editor), responsable |
| C2 | Habilitación de grupos de prueba en la allowlist con `service_role` | Persona autorizada / backend ZEUS-CERBERO | `group_id`, fecha |
| C3 | Generación de la clave publishable para AFRODITA en este proyecto | Persona autorizada | Fecha; la clave solo en el entorno de Railway/local, nunca en el repo ni en el chat |
| C4 | Persistencia de verificaciones en `verified_users` desde ZEUS | Backend ZEUS | Fecha y grupo; ver A8 |

## D. Verificación funcional coordinada (posterior, con autorización explícita)

| ID | Comprobación | Criterio de conformidad |
|---|---|---|
| D1 | Grupo de prueba privado, AFRODITA activada con `/afrodita_activar`, promociones y publicaciones programadas en pausa (`/afrodita_pausar`) | El grupo queda operativo solo para comprobaciones puntuales |
| D2 | `/afrodita_perfil` respondiendo al mensaje de una persona verificada y presente en la allowlist | Autoriza el perfil sin publicar nada más |
| D3 | `/afrodita_perfil` sobre una persona no verificada o de otro grupo | Denegación con el mensaje de no verificado; sin autorización persistida |
| D4 | Durante toda la prueba: sin escrituras ni acciones ajenas | Recuentos de `verified_users` y de la allowlist idénticos antes y después (A7/A8); sin mensajes publicados por AFRODITA más allá de las respuestas a comandos; sin acciones de moderación de CERBERO en el grupo |

## Registro de ejecución

Una fila por comprobación y ronda. `Resultado`: P (cumple), F (no cumple),
P* (cumple con observación), NA (no aplicable). Adjuntar evidencia: `log_id` de
la consulta, salida de comando o captura del dashboard.

| ID | Categoría | Fecha | Responsable | Resultado | Evidencia | Observaciones |
|---|---|---|---|---|---|---|
| A1 | Lectura remota | | | | | |
| A2 | Lectura remota | | | | | |
| A3 | Lectura remota | | | | | |
| A4 | Lectura remota | | | | | |
| A5 | Lectura remota | | | | | |
| A6 | Lectura remota | | | | | |
| A7 | Lectura remota | | | | | |
| A8 | Lectura remota | | | | | |
| A9 | Lectura remota | | | | | |
| B1 | Local | | | | | |
| B2 | Local | | | | | |
| B3 | Local (lectura) | | | | | |
| B4 | Local | | | | | |
| C1 | Autorización humana | | | | | |
| C2 | Autorización humana | | | | | |
| C3 | Autorización humana | | | | | |
| C4 | Autorización humana | | | | | |
| D1 | Funcional coordinada | | | | | |
| D2 | Funcional coordinada | | | | | |
| D3 | Funcional coordinada | | | | | |
| D4 | Funcional coordinada | | | | | |

## Notas finales

- La integración **no se considera verificada** hasta que A1–A9 y B1–B4
  estén conformes con evidencia nueva de la misma ronda; D1–D4 validan el
  comportamiento del bot y solo se ejecutan tras autorización explícita.
- El snapshot de 2026-10-29 documenta lo observado entonces. No prueba el estado
  futuro del proyecto ni sustituye ninguna comprobación de esta lista.
- Ninguna fila del registro de ejecución puede completarse con la evidencia de
  la auditoría original: cada ronda debe generar la suya propia.
- Referencias de contexto: `README.md` (contrato del catálogo), `AFRODITA.md`
  (sección «Modelos verificadas en Supabase»), `DEPLOY.md` (variables por
  proyecto) y `CERBERO/supabase/migrations/012_afrodita_verified_catalog_read.sql`
  y `013_afrodita_verified_catalog_validity.sql` (definición local de la RPC).




