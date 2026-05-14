
## docker build & run

````bash

docker stop floxo-listener && docker rm floxo-listener

docker build -t floxo-listener . && docker run -d \
  --name floxo-listener \
  --env-file .env \
  -p 5004:3000 \
  floxo-listener


docker logs -f floxo-listener

``````


