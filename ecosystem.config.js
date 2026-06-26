module.exports = {
  apps: [
    {
      name: 'bot4',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '350M',
      restart_delay: 3000,
      kill_timeout: 15000,
      min_uptime: '10s',
      max_restarts: 10,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
