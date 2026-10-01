import React from 'react';
import { GuestAssignmentRequestCard } from '../components/GuestAssignmentRequestCard';

export function GuestHomeScreen() {
  return (
    <section className="screen-panel guest-home-screen" data-testid="guest-home-screen">
      <div className="screen-heading compact-heading">
        <h2>Главная</h2>
        <p>Здесь показан статус доступа к выбранному заводу.</p>
      </div>
      <GuestAssignmentRequestCard />
    </section>
  );
}
