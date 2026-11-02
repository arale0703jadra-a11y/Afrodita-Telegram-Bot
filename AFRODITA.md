# AFRODITA

AFRODITA es un proyecto separado del bot administrativo ZEUS. Usa un token de Telegram propio y no reemplaza ni comparte la instancia de ZEUS. Está enfocada en conversación y descubrimiento de productos, servicios y emprendimientos locales. No publica juegos ni retos. Desde esta carpeta:

```powershell
npm install
npm run dev
npm test
npm run typecheck
npm run build
npm start
```

Configura las variables de [`.env.example`](./.env.example) en un `.env` local; no reutilices el token de ZEUS. La activación es por grupo y queda deshabilitada inicialmente. Una persona administradora del grupo puede usar `/afrodita_activar` y `/afrodita_pausar`.

Se requiere Node.js 24.20.0 (versión fijada en `.node-version`). Para arrancar
localmente, completa `AFRODITA_BOT_TOKEN` y ejecuta `npm start` después de
compilar. El token se valida antes de iniciar el polling; no se imprime en los
logs.

## Comandos y panel

- `/start` y `/afrodita` muestran información de uso.
- `/menu` informa que la administración se centralizó en el panel privado de
  ZEUS (sección 🌸 AFRODITA); el panel inline dentro del grupo fue retirado y
  sus botones ya no aplican cambios.
- El panel de ZEUS permite ver resumen, publicaciones, encuestas, menciones,
  grupos, programación e historial, y pausar/reanudar AFRODITA, activar
  categorías y cambiar horarios con confirmación y autorización de propiedad.
- `/afrodita_activar` y `/afrodita_pausar` cambian el estado general del grupo
  y requieren permisos de administración.
- `/afrodita_perfil`, como respuesta al mensaje de una persona, autoriza un
  perfil para promociones tras comprobar su verificación actual y membresía.
  `/afrodita_ocultar` retira el perfil y su consentimiento local.
- `/afrodita_autorizar_promocion` y `/afrodita_retirar_promocion` registran o
  revocan el consentimiento de la propia persona para promociones en ese grupo.

## Conducta y límites

- El grupo empieza desactivado; hasta que una persona administradora lo active, no analiza mensajes ni publica encuestas.
- Las respuestas por actividad ocurren cuando la mencionan, contestan a uno de sus mensajes o hacen una consulta comercial reconocida. Las publicaciones de actividad respetan la configuración y las cuotas de su categoría.
- Las encuestas comerciales se pueden programar por defecto a las 11:00, 16:00 y 21:00 UTC, hasta tres al día y con cuatro horas entre publicaciones; también pueden proponerse después de 40 mensajes del grupo. Un panel permite cambiar estos ajustes.
- Las campañas estacionales usan únicamente las encuestas locales definidas en el código y solo en sus fechas previstas. El horario predeterminado es 18:00 en la zona configurada.
- Las promociones se programan por defecto a las 12:00 y 20:00, con un máximo de dos al día. Requieren que el perfil esté verificado en el catálogo, autorizado por administración para ese grupo y que la persona haya dado consentimiento promocional explícito.
- Las promociones vinculan el nombre visible con el ID de Telegram del perfil mediante una mención explícita. Las consultas de perfil solo se resuelven cuando el nombre o username coincide de forma completa y apunta a una única identidad; coincidencias ambiguas o parciales no seleccionan a nadie. Las respuestas comerciales generales no generan menciones.
- Los rechazos definitivos de Telegram liberan la cuota reservada y esperan el intervalo mínimo antes de reintentar. Si el resultado es ambiguo, se conserva la cuota para evitar duplicados; una reserva que quede sin resolver se marca ambigua después de 30 minutos.
- Los horarios usan la zona configurada por el grupo (UTC por defecto). El estado y los límites son independientes por grupo.
- Las encuestas de Telegram son anónimas; AFRODITA almacena conteos agregados por opción, no identidades de votantes.
- La detección de consultas comerciales puede responder con información de perfiles activos que tengan autorización local y consentimiento vigente. No se envían archivos multimedia: el catálogo consultado actualmente solo aporta identidad básica.
- Los comentarios dirigidos al bot que piden explícitamente menos menciones o mensajes activan una pausa temporal de 12 horas. No intenta inferir estados emocionales.
- Los mensajes entrantes se normalizan antes de clasificar temas o consultas: se eliminan caracteres de control/invisibles y envolturas HTML/Markdown; el contenido nunca se ejecuta como HTML ni script.
- Los mensajes entrantes no se guardan como texto. El estado sí contiene identificadores necesarios para perfiles autorizados, consentimiento y límites por persona, además de métricas agregadas.
- Si el grupo prefiere que el bot no lea mensajes normales, no habilites la recepción amplia de mensajes en BotFather. En ese caso, Telegram puede limitar las interacciones disponibles.

## IA opcional y privacidad

Sin `AFRODITA_AI_CHAT_COMPLETIONS_URL`, `AFRODITA_AI_API_KEY` y `AFRODITA_AI_MODEL`, se usan respuestas locales variadas y no se contacta a un proveedor de IA. Si se configura el endpoint, debe ser HTTPS salvo localhost. La integración es compatible con el formato Chat Completions: envía solo el mensaje actual explícitamente dirigido a Afrodita (máximo 600 caracteres) y una etiqueta de tema agregada; no envía historial, nombres, IDs, métricas individuales ni datos de otros mensajes. Configurarla implica transmitir ese mensaje al proveedor elegido.

La salida se limita en longitud y se descartan respuestas con enlaces, menciones, comandos o algunas afirmaciones sensibles; si el modelo responde `[SILENCIO]`, Afrodita no publica una respuesta. Las reglas están en el prompt y el filtro local; el modelo no puede cambiarlas ni ejecutar código. Este filtro no sustituye un moderador de contenido fiable.

El estado por grupo se guarda separadamente de ZEUS en `data/afrodita/<chatId>.json` por defecto; `AFRODITA_DATA_DIR` permite elegir otro directorio. Incluye ajustes, reservas e historial de publicaciones, datos agregados, IDs/nombres de perfiles autorizados, marcas de consentimiento y límites por persona. No contiene el texto de los mensajes recibidos. Se usa un archivo temporal de permisos restrictivos y reemplazo atómico; las actualizaciones del mismo grupo se serializan dentro del proceso. Si el JSON está dañado, se conserva el original, se crea una copia `.corrupt-*.bak` y se detienen las escrituras hasta su reparación manual.

## Modelos verificadas en Supabase

Para consultar el catálogo compartido, configura `AFRODITA_SUPABASE_URL` y `AFRODITA_SUPABASE_KEY` con una clave de solo lectura protegida por RLS; nunca uses una clave `service_role`. El código consulta la RPC `get_afrodita_verified_catalog` por grupo, limita la respuesta a 500 perfiles y mantiene una caché de 30 segundos. La verificación para otorgar autorización fuerza una consulta nueva. Sin estas variables, las funciones que dependen del catálogo fallan de forma segura.

El catálogo que AFRODITA consume aporta ID, nombre público y username; el código no lee ni envía identificadores multimedia. Estar verificada no concede por sí solo autorización para promociones ni reemplaza el consentimiento expreso de la persona.

Con las mismas variables, AFRODITA también ejecuta la integración con ZEUS:
publica una instantánea de estado por grupo en `afrodita_group_state`, registra
eventos de publicación y encuesta en `afrodita_events` y aplica las órdenes
encoladas por el panel de ZEUS en `afrodita_commands` (pausar, reanudar y
ajustes de categoría) cada minuto. Sin estas variables la integración queda
inactiva y AFRODITA sigue operando de forma autónoma con su estado local.

## Railway

Configura el servicio con raíz `/AFRODITA` en el monorepo, build `npm run build`
y start `npm start`. Railpack detecta `package-lock.json`, los scripts npm y
`.node-version`; no se requiere un comando personalizado ni un archivo de
configuración Railway obsoleto. Mantén una sola réplica: el polling y el
almacenamiento son locales al proceso.

grammY vuelve a intentar la recepción del polling ante errores transitorios y
límites de Telegram. Los rechazos definitivos de publicaciones liberan su cuota
y esperan el intervalo mínimo de la categoría antes de permitir otro intento;
si Telegram o la red devuelve un error ambiguo, repetir la acción podría
duplicar mensajes/encuestas y la cuota se conserva. Una reserva todavía abierta
se considera ambigua después de 30 minutos, sin recuperar su cuota. Los errores
de límite registran el código y el tiempo `retry_after`, sin la descripción ni
el contenido del mensaje.

Configura `AFRODITA_BOT_TOKEN` como variable secreta del servicio. Añade las tres
variables `AFRODITA_AI_CHAT_COMPLETIONS_URL`, `AFRODITA_AI_API_KEY` y
`AFRODITA_AI_MODEL` solo si se habilita expresamente la IA externa. Para
persistencia, crea un volumen y móntalo en una ruta persistente, por ejemplo
`/data/afrodita`, y define `AFRODITA_DATA_DIR=/data/afrodita`.

Para habilitar la lectura de verificadas, define `AFRODITA_SUPABASE_URL` y
`AFRODITA_SUPABASE_KEY` como variables del servicio usando una clave de solo
lectura protegida por RLS.

Railway ejecutará AFRODITA como servicio independiente, por lo que no tendrá
acceso al disco de ZEUS. Sin `AFRODITA_SUPABASE_URL` y `AFRODITA_SUPABASE_KEY`,
los perfiles verificados no podrán consultarse y AFRODITA no los autorizará ni
presentará. Con ambas variables, la lectura remota usa la RPC
`get_afrodita_verified_catalog` sobre los grupos habilitados en la allowlist
administrada con `service_role` en el proyecto compartido; no se debe copiar el
almacén local ni improvisar migraciones.
