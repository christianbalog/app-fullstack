#!/bin/sh

# Remplace la variable d'environnement dans le JS build
if [ -n "$VITE_API_URL" ]; then
  # Trouve tous les fichiers JS dans dist/assets et remplace l'URL
  find /usr/share/nginx/html/assets -name "*.js" -exec sed -i "s|http://localhost:5000|$VITE_API_URL|g" {} \;
fi

# Démarre nginx
nginx -g "daemon off;"
