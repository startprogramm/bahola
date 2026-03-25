module.exports = {
  apps: [
    {
      name: "assessment-checker",
      script: "node_modules/.bin/next",
      args: "start -p 3001",
      cwd: "/home/ubuntu/teztekshir/production",
      env: {
        NODE_ENV: "production",
        APP_MODE: "teztekshir",
        NEXT_PUBLIC_APP_MODE: "teztekshir",
        NEXT_DIST_DIR: ".next-teztekshir",
        NEXTAUTH_URL: "https://teztekshir.uz",
        PORT: 3001,
      },
    },
    {
      name: "maktab",
      script: "node_modules/.bin/next",
      args: "start -p 3002",
      cwd: "/home/ubuntu/teztekshir/production",
      env: {
        NODE_ENV: "production",
        APP_MODE: "maktab",
        NEXT_PUBLIC_APP_MODE: "maktab",
        NEXT_DIST_DIR: ".next-maktab",
        NEXTAUTH_URL: "https://maktab.teztekshir.uz",
        PORT: 3002,
      },
    },
  ],
};
