#!/bin/bash

docker run --name stigman-auth -p 8080:8080 -p 8443:8443 stigman/auth:${1:-dev}