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

## Conducta y límites

- Responde únicamente cuando la mencionan o contestan a uno de sus mensajes; la participación no solicitada es ocasional.
- El motor usa métricas agregadas de temas comerciales, hora UTC, respuestas a Afrodita y votos anónimos por opción. No persiste textos de conversaciones ni identificadores de votantes.
- Los comentarios que piden explícitamente menos menciones o mensajes activan una pausa temporal de 12 horas. No intenta inferir estados emocionales.
- Límites iniciales por grupo: cuatro publicaciones diarias, al menos 15 minutos entre publicaciones, una encuesta por 24 horas y una presentación de perfil por 24 horas.
- Las encuestas son anónimas de Telegram; se reciben actualizaciones de conteo agregado.
- Un perfil solo se presenta si una persona administradora lo autoriza respondiendo al mensaje de una persona que figure como verificada en el registro local de ZEUS. Antes de autorizar y presentar se vuelve a verificar la marca local; al publicarlo también se comprueba la membresía actual en Telegram. Usa `/afrodita_ocultar` en respuesta al mensaje para retirarlo.
- Si el grupo prefiere que el bot no lea mensajes normales, no habilites la recepción amplia de mensajes en BotFather. En ese caso, Telegram puede limitar las interacciones disponibles.

## IA opcional y privacidad

Sin `AFRODITA_AI_CHAT_COMPLETIONS_URL`, `AFRODITA_AI_API_KEY` y `AFRODITA_AI_MODEL`, se usan respuestas locales variadas y no se contacta a un proveedor de IA. Si se configura el endpoint, debe ser HTTPS salvo localhost. La integración es compatible con el formato Chat Completions: envía solo el mensaje actual explícitamente dirigido a Afrodita (máximo 600 caracteres) y una etiqueta de tema agregada; no envía historial, nombres, IDs, métricas individuales ni datos de otros mensajes. Configurarla implica transmitir ese mensaje al proveedor elegido.

La salida se limita en longitud y se descartan respuestas con enlaces, menciones, comandos o algunas afirmaciones sensibles; si el modelo responde `[SILENCIO]`, Afrodita no publica una respuesta. Las reglas están en el prompt y el filtro local; el modelo no puede cambiarlas ni ejecutar código. Este filtro no sustituye un moderador de contenido fiable.

Los datos agregados y la autorización explícita de perfiles se guardan separadamente de ZEUS en `data/afrodita/<chatId>.json` por defecto; `AFRODITA_DATA_DIR` permite elegir otro directorio. Se usa un archivo temporal de permisos restrictivos y reemplazo atómico. Las actualizaciones del mismo grupo se serializan dentro del proceso. Si el JSON está dañado, se conserva el archivo original, se crea una copia `.corrupt-*.bak` y se detienen las escrituras de ese estado hasta que se repare manualmente; no se reemplaza silenciosamente por valores iniciales.

La autorización de un perfil conserva su ID y nombre público para revalidar la verificación y la membresía. Para presentar perfiles, el archivo local de ZEUS `data/storage/<chatId>.json` debe estar disponible en el mismo sistema de archivos. Por defecto, AFRODITA busca en `../ZEUS/data/storage` relativo a su módulo; puede configurarse otra ruta con `AFRODITA_ZEUS_STORAGE_DIR`. Si el archivo falta, está dañado o no puede leerse, la autorización/presentación falla de forma segura; una indisponibilidad temporal no elimina por sí sola una autorización ya guardada.

## Railway

Configura el servicio con raíz `/AFRODITA` en el monorepo, build `npm run build`
y start `npm start`. Railpack detecta `package-lock.json`, los scripts npm y
`.node-version`; no se requiere un comando personalizado ni un archivo de
configuración Railway obsoleto. Mantén una sola réplica: el polling y el
almacenamiento son locales al proceso.

grammY vuelve a intentar la recepción del polling ante errores transitorios y
límites de Telegram. Las publicaciones salientes no se reintentan
automáticamente: si Telegram o la red devuelve un error ambiguo, repetir la
acción podría duplicar mensajes/encuestas. Los errores de límite registran el
código y el tiempo `retry_after`, sin la descripción ni el contenido del mensaje.

Configura `AFRODITA_BOT_TOKEN` como variable secreta del servicio. Añade las tres
variables `AFRODITA_AI_CHAT_COMPLETIONS_URL`, `AFRODITA_AI_API_KEY` y
`AFRODITA_AI_MODEL` solo si se habilita expresamente la IA externa. Para
persistencia, crea un volumen y móntalo en una ruta persistente, por ejemplo
`/data/afrodita`, y define `AFRODITA_DATA_DIR=/data/afrodita`.

Railway ejecutará AFRODITA como servicio independiente, por lo que no tendrá
acceso al disco de ZEUS. En esa configuración los perfiles verificados no
podrán consultarse y AFRODITA no los autorizará ni presentará. No existe una
integración remota implementada. Las opciones futuras son mantener esa función
desactivada en despliegues separados o diseñar, aprobar y probar una API/lectura
de datos compartida con autenticación y permisos mínimos; no se debe copiar el
almacén local ni improvisar migraciones.
