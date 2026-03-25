module.exports = {
  apps: [
    {
      name: "dev-bahola",
      script: "node_modules/.bin/next",
      args: "start -p 4001",
      cwd: "/home/ubuntu/bahola/dev",
      exec_mode: "fork",
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 4001,
        APP_MODE: "bahola",
        NEXT_PUBLIC_APP_MODE: "bahola",
        NEXT_DIST_DIR: ".next-dev-bahola",
        NEXTAUTH_URL: "http://212.20.151.97:4001",
      },
    },
    {
      name: "dev-maktab",
      script: "node_modules/.bin/next",
      args: "start -p 4002",
      cwd: "/home/ubuntu/bahola/dev",
      exec_mode: "fork",
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 4002,
        APP_MODE: "maktab",
        NEXT_PUBLIC_APP_MODE: "maktab",
        NEXT_DIST_DIR: ".next-dev-maktab",
        NEXTAUTH_URL: "http://212.20.151.97:4002",
      },
    },
  ],
};
