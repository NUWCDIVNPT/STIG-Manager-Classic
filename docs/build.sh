#!/bin/bash

SPHINX_IMAGE=sphinxdoc/sphinx

# Change to this script directory
cd "$(dirname "$(realpath "$0")")"

rm -rf _build/*

docker run --rm -v $(pwd):/docs $SPHINX_IMAGE \
  /bin/bash -c "pip3 install -r /docs/requirements.txt && make html && chown -R $(id -u):$(id -g) /docs/_build"