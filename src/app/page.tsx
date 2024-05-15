import React from 'react';
import ProjectCard from './components/ProjectCard';

const Home: React.FC = () => {
  return (
    <div>
      <section className="text-center mt-8">
        <img src="/profile-pic.jpg" alt="Profile Picture" className="w-32 h-32 rounded-full mx-auto" />
        <h2 className="text-3xl mt-4">Your Name</h2>
        <p className="text-gray-600">Software Developer</p>
        <p className="mt-4">Welcome to my personal webpage! Here you can find more about me and my work.</p>
      </section>

      <section className="mt-8">
        <h3 className="text-2xl">About Me</h3>
        <p className="mt-2">I am a software developer with a passion for building web applications. I love working with modern web technologies and constantly learning new things.</p>
      </section>

      <section className="mt-8">
        <h3 className="text-2xl mb-4">Projects</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <ProjectCard
            title="Project 1"
            description="Description of Project 1"
            mediaUrl="/Mitre_demo.mp4"
          />
          <ProjectCard
            title="Project 2"
            description="Description of Project 2"
            mediaUrl="/path-to-your-video-or-gif-2.mp4"
          />
          <ProjectCard
            title="Project 3"
            description="Description of Project 3"
            mediaUrl="/path-to-your-video-or-gif-3.mp4"
          />
        </div>
      </section>
    </div>
  );
};

export default Home;
