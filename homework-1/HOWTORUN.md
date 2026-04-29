# How to Run the Application

All commands in this document must be run from the `homework-1` folder.

## Primary variant: Run via bash script

Use the provided helper script:

```bash
./demo/run.sh
```

This script installs dependencies and starts the app in development mode.

The API will start at:

`http://localhost:3000`

## Secondary variant: Run manually

## 1) Install dependencies

```bash
npm install
```

## 2) Configure environment

Create `.env` file in project root:

```env
PORT=3000
```

You can also copy from `.env.example`.

## 3) Run in development mode

```bash
npm run start:dev
```

The API will start at:

`http://localhost:3000`

## 4) Run tests

```bash
npm test
```

Optional coverage:

```bash
npm run test:cov
```

## 5) Build and run production mode

```bash
npm run build
npm start
```