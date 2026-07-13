if (location.hostname === 'console.anyrouters.com') {
  location.replace(
    'https://anyrouters.com' +
      location.pathname +
      location.search +
      location.hash,
  )
}
