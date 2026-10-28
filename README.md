# AFRODITA — lectura del catálogo verificado

AFRODITA obtiene el catálogo mediante la RPC `public.get_afrodita_verified_catalog(p_group_id)` del proyecto compartido con ZEUS/CERBERO. No consulta directamente `verified_users` y solo recibe `group_id`, `user_id`, `username` y `display_name`; los permisos internos y los identificadores multimedia no se exponen.

## Configuración local

1. Configura `AFRODITA_SUPABASE_URL`.
2. Configura `AFRODITA_SUPABASE_KEY` con una clave publishable (`sb_publishable_…`) o una clave JWT legacy cuyo rol sea `anon`.
3. **No** configures una clave `service_role`, `sb_secret_…` ni otra credencial privilegiada.
4. La migración local `CERBERO/supabase/migrations/012_afrodita_verified_catalog_read.sql` debe ser revisada y aplicada por una persona autorizada antes de que la RPC esté disponible.
5. Habilita explícitamente los grupos aprobados en la allowlist del servidor. No hay grupos precargados. Habilitar un grupo hace públicos los nombres e IDs de sus verificadas mediante esa RPC.

AFRODITA falla de forma cerrada para aprobar o presentar perfiles cuando no puede consultar la RPC. La validación de una autorización de perfil fuerza una consulta actual, sin usar la caché del catálogo. Las respuestas del catálogo se cachean hasta 30 segundos; esto reduce, pero no elimina, la ventana de obsolescencia y no promete propagación instantánea.

## Estado y vigencia

La RPC sigue el estado persistido de ZEUS: una fila se incluye cuando `verified = true` y `revoked_at IS NULL`. `valid_until` no se utiliza para revocar por cuenta propia; ZEUS decide si debe persistir una revocación automática según la preferencia del grupo. Una usuaria vencida solo deja de aparecer después de que ZEUS confirme esa revocación en Supabase.

La aprobación de perfiles consulta esta misma fuente Supabase; el JSON local de ZEUS ya no se usa para autorizar perfiles. El archivo `src/zeus-verification.ts` se conserva como lector legado independiente, pero no forma parte del flujo del bot.

El RPC solo publica identidad básica. AFRODITA no recibe file IDs ni multimedia de Supabase con este contrato; las solicitudes de archivos pueden responder que no hay multimedia autorizada disponible hasta que se diseñe y apruebe un contrato específico de publicación multimedia.
