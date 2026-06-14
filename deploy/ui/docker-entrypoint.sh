#!/bin/sh

# Select the appropriate config based on HTTPS env var
if [ "$HTTPS" = "true" ]; then
    echo "Starting nginx with HTTPS configuration"
    cp /tmp/nginx-https.conf /etc/nginx/conf.d/default.conf
else
    echo "Starting nginx with HTTP configuration"
    cp /tmp/nginx-http.conf /etc/nginx/conf.d/default.conf
fi

# Start nginx
nginx -g 'daemon off;'
