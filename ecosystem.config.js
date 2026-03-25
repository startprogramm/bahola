module.exports = {
  apps: [
    {
      name: "assessment-checker",
      script: "node_modules/.bin/next",
      args: "start -p 3001",
      cwd: "/home/ubuntu/bahola/production",
      env: {
        NODE_ENV: "production",
        APP_MODE: "bahola",
        NEXT_PUBLIC_APP_MODE: "bahola",
        NEXT_DIST_DIR: ".next-bahola",
        NEXTAUTH_URL: "https://bahola.uz",
        PORT: 3001,
      },
    },
    {
      name: "maktab",
      script: "node_modules/.bin/next",
      args: "start -p 3002",
      cwd: "/home/ubuntu/bahola/production",
      env: {
        NODE_ENV: "production",
        APP_MODE: "maktab",
        NEXT_PUBLIC_APP_MODE: "maktab",
        NEXT_DIST_DIR: ".next-maktab",
        NEXTAUTH_URL: "https://maktab.bahola.uz",
        PORT: 3002,
      },
    },
  ],
};
