import React from 'react';
import { FaYoutube, FaGithub, FaLinkedin } from 'react-icons/fa';
import ProjectCard from './components/ProjectCard';

const Home: React.FC = () => {
  return (
    <div>
      <section className="text-center mt-8">

        <div className="w-60 h-60 rounded-full overflow-hidden mx-auto">
          <img 
            src="/profile-pic.jpeg" 
            alt="Profile Picture" 
            className="w-full h-full object-cover" 
          />
        </div>



        <h1 className="text-5xl mt-4">Sid Lakkoju</h1>
        <p className="text-gray-600 mt-2">Computer Science @ UVA</p>
        <p className="mt-4">The world is pretty cool, lets make it cooler ;)</p>

        <div className="flex justify-center space-x-14 mt-4">
          <a href="https://www.youtube.com/@SidLakkoju" target="_blank" className="transform hover:scale-125 transition-transform duration-200">
            <FaYoutube className="text-red-600 w-8 h-8" />
          </a>
          <a href="https://github.com/sidlakkoju" target="_blank" className="transform hover:scale-125 transition-transform duration-200">
            <FaGithub className="text-gray-800 dark:text-white w-8 h-8" />
          </a>
          <a href="https://www.linkedin.com/in/siddharthlakkoju/" target="_blank" className="transform hover:scale-125 transition-transform duration-200">
            <FaLinkedin className="text-blue-700 w-8 h-8" />
          </a>
        </div>
      </section>

      <section className="mt-8">
        <h3 className="text-3xl mb-4">Experience</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <ProjectCard
            title="MITRE Software Engineer Intern (2022)"
            description="Description of Project 1"
            mediaUrl="/Mitre_demo.mp4"
          />
          <ProjectCard
            title="Appian Software Engineer Intern (2023)"
            description="Description of Project 2"
            mediaUrl="/path-to-your-video-or-gif-2.mp4"
          />
        </div>
      </section>

      <section className="mt-8">
        <h3 className="text-3xl mb-4">Projects</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <ProjectCard
            title="Cavalier Autonomous Racing Perception Engineer"
            description="Description of Project 1"
            mediaUrl=""
          />
          <ProjectCard
            title="VTOL"
            description="Description of Project 2"
            mediaUrl="/path-to-your-video-or-gif-2.mp4"
          />
          <ProjectCard
            title="Uvacourseexplorer.com"
            description="Description of Project 2"
            mediaUrl="/path-to-your-video-or-gif-2.mp4"
          />
          <ProjectCard
            title="DQN Reinforcement Learning"
            description="Description of Project 2"
            mediaUrl="/path-to-your-video-or-gif-2.mp4"
          />
          <ProjectCard
            title="Airpods IMU controlled Drone"
            description="Description of Project 2"
            mediaUrl="/path-to-your-video-or-gif-2.mp4"
          />
        </div>
      </section>
    </div>
  );
};

export default Home;
