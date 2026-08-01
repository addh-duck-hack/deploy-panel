# deploy-panel

Panel web para disparar deploys (`git pull` → `docker compose down` → `docker compose up -d --build`)
de tus proyectos en `/docker/` **a demanda**, desde cualquier dispositivo, sin entrar por SSH.

El `git pull` va primero a propósito: si falla (red caída, conflicto), el stack ni se toca y el sitio
sigue arriba con la versión anterior — el downtime solo ocurre si el pull tuvo éxito.

Detecta automáticamente los proyectos desplegables buscando `docker-compose.yml` en:

- `/docker/<proyecto>/` → tipo `fullstack`
- `/docker/staticSite/<proyecto>/` → tipo `static`
- `/docker/wordpress/<proyecto>/` → tipo `wordpress`

## Cómo funciona

- El contenedor `deploy-panel` monta `/docker` (para poder correr `git pull` y `docker compose` dentro
  de cada carpeta de proyecto) y `/var/run/docker.sock` (para controlar el Docker del host).
- Trae su propio Node + `git` + `docker` CLI + plugin `docker compose`, independiente de lo que tengas
  instalado en el host — solo necesita que el daemon Docker del host sea alcanzable vía el socket.
- El acceso al panel está protegido por un token fijo (`DEPLOY_TOKEN`, mínimo 32 caracteres — el
  servidor se niega a arrancar si es más corto). No hay login por usuario/sesión.
- Los logs del deploy se transmiten en vivo a la interfaz vía Server-Sent Events.
- Máximo `MAX_CONCURRENT_DEPLOYS` (default 2) deploys corriendo en paralelo entre todos los proyectos;
  si se supera, responde `429` en vez de saturar el host.
- Cada paso del deploy tiene un timeout (`DEPLOY_STEP_TIMEOUT_MS`, default 20 min); si un comando se
  cuelga, se mata (con todo su árbol de procesos) y el job se marca como fallido en vez de dejar el
  proyecto bloqueado indefinidamente.
- Rate limiting (20 requests/min por IP) en todo `/api/*` para dificultar fuerza bruta sobre el token.

## Setup en el servidor

1. Clona este repo en `/docker/deploy-panel/` (mismo patrón que tus otros proyectos).
2. Crea el `.env` a partir de `.env.example` con un token fuerte:
   ```bash
   cp .env.example .env
   echo "DEPLOY_TOKEN=$(openssl rand -hex 32)" > .env
   ```
   Guarda ese token en un lugar seguro — es lo único que protege el panel, y con él se puede
   ejecutar cualquier comando de deploy sobre cualquier proyecto detectado.
3. Confirma que la red externa `npm` ya existe (la usan tus demás proyectos junto a Nginx Proxy
   Manager). Si no existe: `docker network create npm`.
4. Levanta el panel:
   ```bash
   docker compose up -d --build
   ```
5. Verifica que puede ver el Docker del host:
   ```bash
   docker exec deploy-panel docker ps
   ```

## Exponerlo con Nginx Proxy Manager

1. Crea un nuevo **Proxy Host** en NPM.
2. Domain: por ejemplo `deploy.tudominio.com`.
3. Forward Hostname/IP: `deploy-panel` (nombre del contenedor, resuelve por estar en la red `npm`).
4. Forward Port: `3000`.
5. Activa SSL (Let's Encrypt) y "Force SSL".

## Uso

1. Abre `https://deploy.tudominio.com` desde cualquier dispositivo.
2. Pega el `DEPLOY_TOKEN` cuando lo pida (se guarda en `localStorage` del navegador).
3. Verás un botón por cada proyecto detectado, agrupado por tipo.
4. Al hacer click se dispara el deploy y se abre un panel con el log en vivo. Si el proyecto ya tiene
   un deploy en curso, el botón aparece deshabilitado hasta que termine.

## Notas de seguridad

- El contenedor tiene acceso equivalente a root sobre el host (docker socket + `/docker` completo).
  Trata el `DEPLOY_TOKEN` con el mismo cuidado que una llave SSH: no lo commitees, no lo compartas
  por canales inseguros.
- Si quieres una capa extra, puedes restringir el Proxy Host en NPM con una access list / IP allowlist.
- El link de los logs en vivo (`/api/deploy/:jobId/stream?token=...`) lleva un token de un solo job en
  la query string (no el `DEPLOY_TOKEN` real) porque `EventSource` no permite mandar headers custom.
  Nginx suele loguear la URL completa con query string en su access log — si te preocupa que ese token
  de corta duración quede en esos logs, en el Proxy Host de NPM puedes agregar en "Custom Nginx
  Configuration" algo como:
  ```
  location /api/deploy/ {
    access_log off;
    proxy_pass http://deploy-panel:3000;
  }
  ```
  o ajustar el `log_format` para omitir el query string en esa ruta.
- Mejora opcional no aplicada aún: el proceso Node corre como root dentro del contenedor (sin `USER` en
  el Dockerfile). No es la causa del acceso root-equivalente (eso ya es el docker socket), pero reduce
  el blast radius si alguna dependencia npm tuviera una vulnerabilidad de escritura de archivos.
  Requiere que el usuario del contenedor esté en un grupo con el mismo GID que `docker.sock` en el host
  — no se implementó porque ese GID varía por servidor y probarlo mal podría dejar el panel sin poder
  hablar con Docker.
