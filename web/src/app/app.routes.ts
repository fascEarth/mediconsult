import { Routes } from '@angular/router';
import { requireRole } from './core/auth';


export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home.page').then((m) => m.default), title: 'MediConsult · See a doctor online' },
  { path: 'doctors', loadComponent: () => import('./pages/doctors.page').then((m) => m.default), title: 'Find a doctor · MediConsult' },
  { path: 'doctors/:id', loadComponent: () => import('./pages/doctor.page').then((m) => m.default), title: 'Doctor · MediConsult' },
  { path: 'login', loadComponent: () => import('./pages/login.page').then((m) => m.default), title: 'Sign in · MediConsult' },
  { path: 'register', loadComponent: () => import('./pages/register.page').then((m) => m.default), title: 'Create account · MediConsult' },
  { path: 'register/doctor', loadComponent: () => import('./pages/register-doctor.page').then((m) => m.default), title: 'Join as a doctor · MediConsult' },
  { path: 'legal/:doc', loadComponent: () => import('./pages/legal.page').then((m) => m.default) },
  { path: 'checkout/:id', canActivate: [requireRole('PATIENT')], loadComponent: () => import('./pages/checkout.page').then((m) => m.default), title: 'Checkout · MediConsult' },
  { path: 'dashboard', canActivate: [requireRole('PATIENT', 'DOCTOR')], loadComponent: () => import('./pages/dashboard.page').then((m) => m.default), title: 'Dashboard · MediConsult' },
  { path: 'appointments/:id', canActivate: [requireRole('PATIENT', 'DOCTOR', 'ADMIN')], loadComponent: () => import('./pages/appointment.page').then((m) => m.default), title: 'Consultation · MediConsult' },
  { path: 'consult/:id', canActivate: [requireRole('PATIENT', 'DOCTOR')], loadComponent: () => import('./pages/consult.page').then((m) => m.default), title: 'Video consultation · MediConsult' },
  { path: 'prescription/:id', canActivate: [requireRole('PATIENT', 'DOCTOR')], loadComponent: () => import('./pages/prescription.page').then((m) => m.default), title: 'Prescription · MediConsult' },
  { path: 'profile', canActivate: [requireRole('PATIENT')], loadComponent: () => import('./pages/profile.page').then((m) => m.default), title: 'Health profile · MediConsult' },
  { path: 'doctor/settings', canActivate: [requireRole('DOCTOR')], loadComponent: () => import('./pages/doctor-settings.page').then((m) => m.default), title: 'Practice settings · MediConsult' },
  { path: 'admin', canActivate: [requireRole('ADMIN')], loadComponent: () => import('./pages/admin.page').then((m) => m.default), title: 'Admin · MediConsult' },
  { path: '**', redirectTo: '' },
];
