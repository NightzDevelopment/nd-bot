/**
 * Quick setup script to create initial admin user for dashboard v2
 * Usage: bun scripts/setup-dashboard-admin.ts
 */

import { createUser, getUserByEmail } from '../src/dashboard/users.ts'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe123!'

async function setupAdmin() {
  console.log('🔧 Dashboard v2 Admin Setup')
  console.log('==========================\n')

  try {
    // Check if admin already exists
    const existing = await getUserByEmail(ADMIN_EMAIL)
    if (existing) {
      console.log(`✅ Admin user already exists: ${ADMIN_EMAIL}`)
      console.log(`\nTo login:`)
      console.log(`  Email: ${ADMIN_EMAIL}`)
      console.log(`  Password: [the password you set]`)
      console.log(`\n📍 Access dashboard: http://127.0.0.1:3849/pages/splash.html`)
      return
    }

    // Create admin user
    console.log(`📝 Creating admin user...`)
    const user = await createUser(ADMIN_EMAIL, ADMIN_PASSWORD, 'admin', [])

    console.log(`✅ Admin user created successfully!\n`)
    console.log(`📋 User Details:`)
    console.log(`  ID: ${user.id}`)
    console.log(`  Email: ${user.email}`)
    console.log(`  Role: ${user.role}`)
    console.log(`  Created: ${new Date(user.createdAt).toISOString()}\n`)

    console.log(`🔑 Login Credentials:`)
    console.log(`  Email: ${ADMIN_EMAIL}`)
    console.log(`  Password: ${ADMIN_PASSWORD}\n`)

    console.log(`⚠️  IMPORTANT: Change the password after first login!\n`)

    console.log(`📍 Next Steps:`)
    console.log(`  1. Open http://127.0.0.1:3849/pages/splash.html`)
    console.log(`  2. Click "Email" tab`)
    console.log(`  3. Enter credentials above`)
    console.log(`  4. Select server and click "Continue"\n`)

    console.log(`📖 Integration Guide: src/dashboard/auth-handlers.ts`)
    console.log(`   (Shows how to wire auth endpoints into server.ts)\n`)
  } catch (err) {
    console.error('❌ Setup failed:', err)
    process.exit(1)
  }
}

setupAdmin()
